import { providers } from './provider-registry.js';
import { parsePath, resolvePath, formatValue } from './utils/path-resolver.js';
import { roundCounterNext, promptCounterNext, promptCounterReset } from './utils/counter.js';

/**
 * Render a template by executing all registered providers once,
 * caching their results, then replacing all placeholders in two passes:
 *
 *   Pass 1 — Simple placeholders:  {{name}}            → content
 *   Pass 2 — Path queries:         {{name:path|fallback}} → resolved data value
 *
 * Providers are executed exactly once per renderPrompt() call,
 * regardless of how many placeholders reference them.
 *
 * Special placeholder: {{counter}} increments per occurrence across
 * all renderPrompt() calls. Each occurrence gets a unique monotonic
 * value (1, 2, 3...). Resets on GROUP_WRAPPER_STARTED.
 */
export async function renderPrompt(template, context, options = {}) {
    const { maxPasses: maxPassesOption, recursive } = options;
    // Clamp: positive, reasonable ceiling to guard against typos (e.g. 99999).
    // Early-exit on no-change makes a high value harmless in practice.
    const maxPasses = recursive === false
        ? 1
        : Math.max(1, Math.min(maxPassesOption ?? 5, 1000));
    // Reset per-prompt counter at the start of each render call
    promptCounterReset();

    // ── Phase 1: execute every provider, cache normalized results ──
    const cache = Object.create(null); // providerId → { content, data }

    for (const provider of providers.values()) {
        if (provider.enabled && !provider.enabled(context)) continue;
        try {
            const raw = await provider.render(context);
            const normalized = (raw && typeof raw === 'object')
                ? { content: raw.content ?? '', data: raw.data ?? null }
                : { content: raw ?? '', data: null };
            cache[provider.id] = normalized;
        } catch (e) {
            console.warn(`[GroupDirector] Provider "${provider.id}" render failed:`, e.message);
            cache[provider.id] = { content: '', data: null };
        }
    }

    // ── Phase 2: simple placeholders {{name}} ──
    // {{counter}}   → round lifetime, starts at 0, persists across renderPrompt calls
    // {{counter0}}  → prompt lifetime, starts at 0, resets each renderPrompt call
    // Unrecognized placeholders stay as-is so typos (e.g. {{charcters}}) are visible.
    let result = template.replace(/\{\{(\w+)\}\}/g, (match, id) => {
        if (id === 'counter') return String(roundCounterNext());
        if (id === 'counter0') return String(promptCounterNext());
        if (!(id in cache)) return match;
        return cache[id].content;
    });

    // ── Phase 3: path queries {{?name:path|fallback}} ──
    // The `?` after `{{` distinguishes path queries from simple placeholders.
    // {{name}} goes to Phase 2; {{?name:path}} or {{?name:path|default}} goes here.
    // Unknown provider → preserve as-is. Known provider with unresolvable path → fallback.
    result = result.replace(/\{\{\?(\w+):([^}|]+)(?:\|([^}]*))?\}\}/g, (match, id, path, fallback) => {
        const entry = cache[id];
        if (!entry) return match;
        if (!entry.data) return fallback ?? '';

        const expandedPath = expandVariables(path.trim(), context);
        const segments = parsePath(expandedPath);
        const value = resolvePath(entry.data, segments);

        if (value === null || value === undefined) return fallback ?? '';
        return formatValue(value);
    });

    // ── Post-render passes ──
    // After replacing placeholders, the injected content itself may contain
    // new {{...}} references (e.g. a director script stored in the ledger
    // that references {{?directorLedger:politics}}). Re-run Phase 2 + Phase 3
    // until no new replacements occur or the max depth is reached.
    for (let pass = 1; pass < maxPasses; pass++) {
        const before = result;

        // Phase 2 (re-pass): skip counters — they were already consumed
        result = result.replace(/\{\{(\w+)\}\}/g, (match, id) => {
            if (id === 'counter' || id === 'counter0') return match;
            if (!(id in cache)) return match;
            return cache[id].content;
        });

        // Phase 3 (re-pass)
        result = result.replace(/\{\{\?(\w+):([^}|]+)(?:\|([^}]*))?\}\}/g, (match, id, path, fallback) => {
            const entry = cache[id];
            if (!entry) return match;
            if (!entry.data) return fallback ?? '';
            const expandedPath = expandVariables(path.trim(), context);
            const segments = parsePath(expandedPath);
            const value = resolvePath(entry.data, segments);
            if (value === null || value === undefined) return fallback ?? '';
            return formatValue(value);
        });

        if (result === before) break; // no more replacements — done
    }

    return result;
}

/**
 * Replace $variable tokens in a path string with values from context.
 * Values containing path-special characters are automatically quoted.
 */
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
