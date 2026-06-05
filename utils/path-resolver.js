/**
 * Parse a JSON path string into segments.
 * Supports: dot notation, array indices, quoted keys.
 *
 * Examples:
 *   "memory.location"       → ["memory", "location"]
 *   "events[0].title"       → ["events", 0, "title"]
 *   '["key.with.dots"]'     → ["key.with.dots"]
 *   "items[2]"              → ["items", 2]
 */
export function parsePath(path) {
    const segments = [];
    let i = 0;

    while (i < path.length) {
        // Skip leading dots
        if (path[i] === '.') { i++; continue; }

        // Whitespace
        if (path[i] === ' ') { i++; continue; }

        // Quoted key: "key" or 'key'
        if (path[i] === '"' || path[i] === "'") {
            const quote = path[i];
            i++;
            let key = '';
            while (i < path.length && path[i] !== quote) {
                if (path[i] === '\\' && i + 1 < path.length) {
                    key += path[++i];
                } else {
                    key += path[i];
                }
                i++;
            }
            if (i < path.length) i++; // skip closing quote
            segments.push(key);
            continue;
        }

        // Array index: [n]
        if (path[i] === '[') {
            i++;
            let num = '';
            while (i < path.length && path[i] !== ']') {
                num += path[i];
                i++;
            }
            if (i < path.length) i++; // skip ]
            const n = parseInt(num, 10);
            if (!isNaN(n)) segments.push(n);
            continue;
        }

        // Plain identifier key
        let key = '';
        while (i < path.length && path[i] !== '.' && path[i] !== '[' && path[i] !== ' ') {
            key += path[i];
            i++;
        }
        if (key) segments.push(key);
    }

    return segments;
}

/**
 * Walk an object along parsed segments. Returns undefined if any step is missing.
 */
export function resolvePath(obj, segments) {
    if (obj === null || obj === undefined) return undefined;
    let current = obj;
    for (const seg of segments) {
        if (current === null || current === undefined) return undefined;
        if (typeof seg === 'number') {
            if (!Array.isArray(current)) return undefined;
            current = current[seg];
        } else {
            if (typeof current !== 'object') return undefined;
            current = current[seg];
        }
    }
    return current;
}

/**
 * Format a resolved value for template insertion.
 * - string/number/boolean → direct string
 * - object/array → JSON.stringify
 * - null/undefined → empty string
 */
export function formatValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value, null, 2);
}
