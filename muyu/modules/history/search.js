import { fingerprint } from '../../context/planner.js';

export const SEARCH_LIMITS = Object.freeze({ messages: 32, chars: 65536, hits: 8, query: 128, snippet: 240 });
const lowSurrogate = char => /[\uDC00-\uDFFF]/.test(char);
const fold = text => text.replace(/[A-Z]/g, char => char.toLowerCase());

/** Pure bounded literal lookup. No embeddings, regex execution, storage or grants. */
export function searchHistory(messages, { query, offset, start, fingerprint: expected = '', caseSensitive = false }) {
    if (typeof query !== 'string' || !query.trim() || query.length > SEARCH_LIMITS.query ||
        !Number.isSafeInteger(offset) || offset < 0 || offset > messages.length ||
        !Number.isSafeInteger(start) || start < 0 || typeof caseSensitive !== 'boolean') throw Error('HISTORY_INVALID_SEARCH');
    const initial = messages[offset];
    if (start > 0 && !expected || expected && (!initial || fingerprint(initial) !== expected) ||
        initial && (start > initial.content.length || lowSurrogate(initial.content.charAt(start))) || !initial && start !== 0) throw Error('HISTORY_STALE');
    const needle = caseSensitive ? query : fold(query), items = [];
    let index = offset, position = start, scannedMessages = 0, scannedChars = 0;
    while (index < messages.length && scannedMessages < SEARCH_LIMITS.messages && scannedChars < SEARCH_LIMITS.chars && items.length < SEARCH_LIMITS.hits) {
        const message = messages[index], content = message.content;
        scannedMessages++;
        const span = Math.min(content.length - position, SEARCH_LIMITS.chars - scannedChars);
        // Overlap finds a literal straddling the scan boundary without double hits.
        const window = content.slice(position, position + span + needle.length - 1);
        const match = (caseSensitive ? window : fold(window)).indexOf(needle);
        scannedChars += span;
        if (match >= 0 && match < span) {
            const matchStart = position + match, matchEnd = matchStart + query.length;
            let snippetStart = Math.max(0, matchStart - 48);
            if (lowSurrogate(content.charAt(snippetStart))) snippetStart--;
            let snippetEnd = Math.min(content.length, snippetStart + SEARCH_LIMITS.snippet);
            if (lowSurrogate(content.charAt(snippetEnd))) snippetEnd--;
            items.push({ index, role: message.role, fingerprint: fingerprint(message), start: snippetStart, end: snippetEnd,
                matchStart, matchEnd, total: content.length, text: content.slice(snippetStart, snippetEnd) });
            // One hit per message; read its surroundings or search again at matchEnd.
            index++; position = 0;
        } else if (position + span >= content.length) { index++; position = 0; }
        else {
            position += span;
            if (lowSurrogate(content.charAt(position))) position--;
            break;
        }
    }
    const complete = index >= messages.length;
    return { total: messages.length, scannedMessages, scannedChars, complete,
        nextOffset: complete ? -1 : index, nextStart: complete ? 0 : position,
        nextFingerprint: !complete && position > 0 ? fingerprint(messages[index]) : '', items };
}
