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
export async function renderPrompt(template, context) {
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
    let result = template.replace(/\{\{(\w+)\}\}/g, (match, id) => {
        if (id === 'counter') return String(roundCounterNext());
        if (id === 'counter0') return String(promptCounterNext());
        return cache[id]?.content ?? '';
    });

    // ── Phase 3: path queries {{?name:path|fallback}} ──
    // The `?` after `{{` distinguishes path queries from simple placeholders.
    // {{name}} goes to Phase 2; {{?name:path}} or {{?name:path|default}} goes here.
    result = result.replace(/\{\{\?(\w+):([^}|]+)(?:\|([^}]*))?\}\}/g, (match, id, path, fallback) => {
        const entry = cache[id];
        if (!entry || !entry.data) return fallback ?? '';

        const expandedPath = expandVariables(path.trim(), context);
        const segments = parsePath(expandedPath);
        const value = resolvePath(entry.data, segments);

        if (value === null || value === undefined) return fallback ?? '';
        return formatValue(value);
    });

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
