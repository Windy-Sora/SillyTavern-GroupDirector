import { normalizeCritiqueData } from './critique-validation.js';

function sanitizeJson(text) {
    return text
        .replace(/,(\s*[}\]])/g, '$1')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ');
}

function findBalancedObjectEnd(text, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index++) {
        const char = text[index];
        if (escaped) { escaped = false; continue; }
        if (inString && char === '\\') { escaped = true; continue; }
        if (char === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (char === '{') depth++;
        else if (char === '}' && --depth === 0) return index;
    }
    return -1;
}

export function extractCritiqueJson(text) {
    if (typeof text !== 'string') return null;
    for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
        const end = findBalancedObjectEnd(text, start);
        if (end < 0) continue;
        try {
            return JSON.parse(sanitizeJson(text.slice(start, end + 1)));
        } catch (_) {
            // A prose brace or malformed candidate may precede the real JSON object.
        }
    }
    return null;
}

export function parseCritiqueResponse(text) {
    const parsed = extractCritiqueJson(text);
    if (parsed === null) return null;
    return normalizeCritiqueData(parsed, { path: 'LLM critique response' });
}
