import { HISTORY_LIMITS, validateRecord, historyBytes } from './contract.js';
import { receiptText, receiptSources } from '../actions/receipts.js';

/** Import preview is data only. It can never create a runnable conversation. */
export function parseHistoryImport(text) {
    if (typeof text !== 'string' || text.length > HISTORY_LIMITS.recordBytes || new TextEncoder().encode(text).length > HISTORY_LIMITS.recordBytes) throw Error('HISTORY_CAPACITY');
    let value;
    try { value = JSON.parse(text, (key, data) => { if (['__proto__', 'constructor', 'prototype'].includes(key)) throw Error(); return data; }); }
    catch { throw Error('HISTORY_INVALID'); }
    return validateRecord(value);
}
export function importedRecord(source, now = Date.now()) {
    const record = validateRecord(source);
    return validateRecord({ ...record, id: crypto.randomUUID(), revision: 0, createdAt: now, updatedAt: now,
        imported: true, archived: false, status: record.status === 'running' ? 'interrupted' : record.status,
        // Not grants, and not trusted as a claim about the original data's provenance.
        required: [...new Set(['diagnostics', 'chat', 'extended', ...(record.receipts || []).filter(r => r.version >= 2).flatMap(receiptSources)])] });
}
export function exportHistoryRecord(record, format = 'json') {
    const r = validateRecord(record);
    if (format === 'json') return JSON.stringify(r); // Bounded file can be imported again.
    if (format !== 'markdown') throw Error('HISTORY_INVALID');
    // Literal fenced blocks prevent record text from becoming active HTML/images in Markdown viewers.
    const block = text => {
        let longest = 2; for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
        const fence = '`'.repeat(longest + 1); return `${fence}text\n${text}\n${fence}`;
    };
    return ['# Muyu conversation', block(r.title || 'Untitled'), 'Scope (original):', block(r.scope),
        ...r.messages.flatMap(m => [`## ${m.role === 'user' ? 'User' : 'Muyu'}`, block(m.content)]), ...(r.receipts || []).flatMap(r => ['## Historical operation result', block(receiptText(r, 'en'))])].join('\n\n');
}
export function importPreview(text) {
    const record = parseHistoryImport(text);
    return { title: record.title, scope: record.scope, messages: record.messages.length, bytes: historyBytes(record) };
}
