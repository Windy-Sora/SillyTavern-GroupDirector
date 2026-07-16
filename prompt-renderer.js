import { providers } from './provider-registry.js';
import { parsePath, resolvePath, formatValue } from './utils/path-resolver.js';
import { roundCounterNext, promptCounterNext, promptCounterReset } from './utils/counter.js';
import { unescapeKnowledge } from './assets/providers/knowledge.js';

// Default per-provider render timeout (ms). Overridden by provider.timeoutMs or
// the providerTimeoutMs render option. 0 disables the timeout for a provider.
// index.js wires this to settings.providerTimeoutMs via setProviderTimeoutDefault().
let providerTimeoutDefault = 10000;
export function setProviderTimeoutDefault(ms) {
    const n = Number(ms);
    if (Number.isFinite(n) && n >= 0) providerTimeoutDefault = n;
}

/**
 * Render a template by executing all registered providers once,
 * caching their results, then replacing all placeholders in passes:
 *
 *   Phase 1   — Execute providers, cache results
 *   Phase 1.5 — Block loops: {{#provider:path}}...{{/provider}}
 *   Phase 2   — Simple placeholders: {{name}} → content
 *   Phase 3   — Path queries: {{?name:path|fallback}} → resolved value
 *
 * Providers are executed exactly once per renderPrompt() call,
 * regardless of how many placeholders reference them.
 *
 * Special placeholder: {{counter}} increments per occurrence across
 * all renderPrompt() calls. Each occurrence gets a unique monotonic
 * value (0, 1, 2...). Resets on GROUP_WRAPPER_STARTED.
 */
export async function renderPrompt(template, context, options = {}) {
    const { maxPasses: maxPassesOption, recursive, debugPlaceholders, locals, onCache, passthrough, signal, providerTimeoutMs } = options;
    const maxPasses = recursive === false
        ? 1
        : Math.max(1, Math.min(maxPassesOption ?? 5, 1000));
    const unresolvable = debugPlaceholders ? (m) => m : () => '';
    promptCounterReset();

    // ── Phase 0: raw passthrough {[{...}]} ──
    // Content inside {[{...}]} bypasses all rendering — e.g.
    // {[{ {{characters}} }]} → literal "{{characters}}" in output.
    // Useful for teaching the LLM DSL syntax without evaluation.
    const rawSlots = [];
    const RAW_MARKER = '\x00GDRAW';
    let result = template.replace(/\{\[\{([\s\S]*?)\}\]\}/g, (_m, inner) => {
        const idx = rawSlots.length;
        rawSlots.push(inner);
        return `${RAW_MARKER}${idx}\x00`;
    });

    // ── Phase 1: execute providers in parallel, each with its own timeout + abort,
    //    cache normalized results. Per-provider errors/timeouts degrade to empty
    //    (siblings survive); a user abort (signal) propagates to cancel the render.
    const cache = Object.create(null);
    const callTimeout = providerTimeoutMs ?? providerTimeoutDefault;

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const enabledProviders = [];
    for (const provider of providers.values()) {
        if (typeof provider.enabled === 'function' ? !provider.enabled(context) : provider.enabled === false) continue;
        enabledProviders.push(provider);
    }

    const results = await Promise.allSettled(enabledProviders.map(async (provider) => {
        // Per-provider timeout: provider.timeoutMs (declared) > call option > global default.
        const timeoutMs = Number(provider.timeoutMs ?? callTimeout);
        // One AbortController per provider: fires on timeout OR user-stop (linked to `signal`).
        const ac = new AbortController();
        let onUserAbort = null;
        if (signal) {
            if (signal.aborted) ac.abort();
            else { onUserAbort = () => ac.abort(); signal.addEventListener('abort', onUserAbort, { once: true }); }
        }
        let timeoutId = null;
        if (timeoutMs > 0) {
            timeoutId = setTimeout(() => ac.abort(new DOMException(`Provider "${provider.id}" timeout (${timeoutMs}ms)`, 'TimeoutError')), timeoutMs);
        }
        // Forced-abort promise: rejects when ac fires, so a provider that ignores its
        // signal is still cut. Listener is removed in finally to allow GC.
        let onAbort = null;
        const abortP = new Promise((_, reject) => {
            if (ac.signal.aborted) reject(ac.signal.reason ?? new DOMException('Aborted', 'AbortError'));
            else {
                onAbort = () => reject(ac.signal.reason ?? new DOMException('Aborted', 'AbortError'));
                ac.signal.addEventListener('abort', onAbort, { once: true });
            }
        });
        try {
            // Cooperative: ac.signal passed to render; a provider may honor it (e.g. fetch).
            const raw = await Promise.race([provider.render(context, ac.signal), abortP]);
            const normalized = (raw && typeof raw === 'object')
                ? { content: raw.content ?? '', data: raw.data ?? null }
                : { content: raw ?? '', data: null };
            return { id: provider.id, normalized };
        } catch (e) {
            // User-stop: propagate so the whole renderPrompt aborts.
            if (signal?.aborted || e?.name === 'AbortError') throw e;
            // Timeout or provider error: degrade to empty, keep siblings alive.
            const kind = e?.name === 'TimeoutError' ? 'timed out' : 'render failed';
            console.warn(`[GroupDirector] Provider "${provider.id}" ${kind}:`, e.message);
            return { id: provider.id, normalized: { content: '', data: null } };
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
            if (onUserAbort) signal.removeEventListener('abort', onUserAbort);
            if (onAbort) ac.signal.removeEventListener('abort', onAbort);
        }
    }));

    for (const r of results) {
        if (r.status === 'fulfilled') {
            cache[r.value.id] = r.value.normalized;
        } else {
            // Rejection only happens on user-stop (everything else is caught above).
            if (signal?.aborted || r.reason?.name === 'AbortError') throw r.reason;
            console.warn('[GroupDirector] Provider unexpected rejection:', r.reason);
        }
    }

    // Inject local resolvers — per-call placeholder overrides that don't
    // go through the global Provider registry. Agent data placeholders
    // (e.g. {{existingCharacters}}) use this to avoid being cleared.
    if (locals) {
        for (const [id, content] of Object.entries(locals)) {
            cache[id] = { content: String(content ?? ''), data: null };
        }
    }

    // Allow external observer to snapshot provider outputs (trace/debug)
    if (onCache) {
        try {
            const snap = Object.create(null);
            for (const [id, entry] of Object.entries(cache)) {
                snap[id] = { content: entry.content?.length ?? 0, hasData: !!entry.data };
            }
            onCache(snap);
        } catch (_) { /* never throw from observer */ }
    }

    // ── Phase 1.5: block loops ──
    result = processBlockLoops(result, cache, context, unresolvable, false, passthrough);

    // ── Phase 2+3: placeholders and path queries ──
    result = renderPhases2and3(result, cache, context, unresolvable, false, passthrough);

    // ── Post-render passes ──
    for (let pass = 1; pass < maxPasses; pass++) {
        const before = result;
        result = processBlockLoops(result, cache, context, unresolvable, true, passthrough);
        result = renderPhases2and3(result, cache, context, unresolvable, true, passthrough);
        if (result === before) break;
    }

    // ── Restore raw passthrough slots ──
    for (let i = 0; i < rawSlots.length; i++) {
        result = result.split(`${RAW_MARKER}${i}\x00`).join(rawSlots[i]);
    }

    // ── Unescape knowledge provider content ──
    result = unescapeKnowledge(result);

    return result;
}

// ─────────────────────────────────────────────────────────────────

/**
 * Phase 2 + Phase 3: resolve simple placeholders and path queries
 * in a single pass. When isRePass is true, counters are preserved
 * rather than incremented.
 */
function renderPhases2and3(template, cache, context, unresolvable, isRePass = false, passthrough) {
    // Phase 2
    let result = template.replace(/\{\{(\w+)\}\}/g, (match, id) => {
        if (id === 'counter' || id === 'counter0') {
            return isRePass ? match : String(id === 'counter' ? roundCounterNext() : promptCounterNext());
        }
        // Passthrough: ST-native or user-specified placeholders left as-is
        if (passthrough && (passthrough === true || passthrough.includes(id))) {
            return match;
        }
        if (!(id in cache)) return unresolvable(match);
        return cache[id].content;
    });

    // Phase 3
    result = result.replace(/\{\{\?(\w+):([^}|]+)(?:\|([^}]*))?\}\}/g, (match, id, path, fallback) => {
        const entry = cache[id];
        if (!entry) return unresolvable(match);
        if (!entry.data) return fallback ?? '';

        const innerResolved = resolveInnerPlaceholders(path, cache, context);
        const expandedPath = expandVariables(innerResolved.trim(), context);
        const segments = parsePath(expandedPath);
        const value = resolvePath(entry.data, segments);

        if (value === null || value === undefined) return fallback ?? '';
        return formatValue(value);
    });

    return result;
}

// ─────────────────────────────────────────────────────────────────
// Block Loops: {{#provider:path}}inner{{/provider}}
// ─────────────────────────────────────────────────────────────────

/**
 * Process block-loop expressions.
 *
 * Syntax:
 *   {{#provider:path}}
 *     inner template (can contain any {{...}} placeholder)
 *   {{/provider}}
 *
 * - Resolves path against cache[provider].data to get an array
 * - Deduplicates the array (Set, works for primitives)
 * - Renders inner template for each element with $it = element
 * - Empty/null array → whole block replaced with empty string
 * - Join uses literal newlines from the template (user controls)
 */
function processBlockLoops(template, cache, context, unresolvable, isRePass, passthrough) {
    let result = template;
    let safety = 0;
    const MAX_BLOCKS = 200;

    // Process from innermost outward until no more blocks remain
    while (safety++ < MAX_BLOCKS) {
        // Find all blocks in current result
        const blocks = findAllBlocks(result);
        if (blocks.length === 0) break;

        // Process innermost first (shortest inner → deepest nesting)
        blocks.sort((a, b) => a.innerLength - b.innerLength);
        const block = blocks[0];

        const inner = result.slice(block.openEnd, block.closeIdx);

        // Resolve path to get array
        const array = resolveArray(cache, block.providerId, block.path, context);
        if (!Array.isArray(array) || array.length === 0) {
            result = result.slice(0, block.openStart) + result.slice(block.closeEnd);
            continue;
        }

        // Deduplicate (primitive-safe)
        const unique = [...new Set(array)];

        // Render inner for each element
        const parts = unique.map(el => {
            const elCtx = { ...context, it: formatValue(el) };
            return renderPhases2and3(inner, cache, elCtx, unresolvable, isRePass, passthrough);
        });

        // Replace entire block with joined results
        result = result.slice(0, block.openStart) + parts.join('\n') + result.slice(block.closeEnd);
    }

    return result;
}

function findAllBlocks(template) {
    const openRegex = /\{\{#(\w+):([^}]+)\}\}/g;
    const blocks = [];
    let match;

    while ((match = openRegex.exec(template)) !== null) {
        const providerId = match[1];
        const openStart = match.index;
        const openEnd = match.index + match[0].length;
        const closeTag = `{{/${providerId}}}`;
        const closeIdx = template.indexOf(closeTag, openEnd);

        if (closeIdx !== -1) {
            blocks.push({
                providerId,
                path: match[2],
                openStart,
                openEnd,
                closeIdx,
                closeEnd: closeIdx + closeTag.length,
                innerLength: closeIdx - openEnd,
            });
        }
    }

    return blocks;
}

/**
 * Resolve a path expression against a provider's data to get an array.
 * Returns the resolved value if it's an array, otherwise null.
 */
function resolveArray(cache, providerId, path, context) {
    const entry = cache[providerId];
    if (!entry || !entry.data) return null;

    const innerResolved = resolveInnerPlaceholders(path, cache, context);
    const expandedPath = expandVariables(innerResolved.trim(), context);
    const segments = parsePath(expandedPath);
    const value = resolvePath(entry.data, segments);

    return Array.isArray(value) ? value : null;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function expandVariables(path, context) {
    if (!context) return path;
    return path.replace(/\$(\w+)/g, (match, varName) => {
        const val = context[varName];
        if (val === undefined || val === null) return match;
        const s = String(val);
        if (/[.\[\] ]/.test(s)) {
            return `["${s.replace(/"/g, '\\"')}"]`;
        }
        return s;
    });
}

function resolveInnerPlaceholders(pathStr, cache, context) {
    let prev;
    let guard = 0;
    do {
        if (++guard > 16) { console.warn('[GroupDirector] resolveInnerPlaceholders exceeded max iterations (16) — possible circular reference'); break; }
        prev = pathStr;
        pathStr = pathStr.replace(/\{\{([^{}]+)\}\}/g, (_match, inner) => {
            if (/^\w+$/.test(inner)) {
                if (inner === 'counter' || inner === 'counter0') return '';
                if (!(inner in cache)) return '';
                return cache[inner].content;
            }
            const m = /^\?(\w+):([^|]+)(?:\|(.+))?$/.exec(inner);
            if (m) {
                const [, id, subpath, fallback] = m;
                const entry = cache[id];
                if (!entry) return fallback ?? '';
                if (!entry.data) return fallback ?? '';
                const expandedSubpath = expandVariables(subpath.trim(), context);
                const segments = parsePath(expandedSubpath);
                const value = resolvePath(entry.data, segments);
                if (value === null || value === undefined) return fallback ?? '';
                return formatValue(value);
            }
            return '';
        });
    } while (pathStr !== prev);
    return pathStr;
}
