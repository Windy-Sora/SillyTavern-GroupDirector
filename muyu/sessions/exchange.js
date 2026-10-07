import { randomUUID } from '../runtime/crypto.js';
import { HISTORY_LIMITS, validateRecord, historyBytes } from './contract.js';
import { receiptText, receiptSources } from '../actions/receipts.js';
import { MAX_MESSAGE_BYTES } from '../core/context-limits.js';

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
    return validateRecord({ ...record, id: randomUUID(), revision: 0, createdAt: now, updatedAt: now,
        imported: true, archived: false, status: record.status === 'running' ? 'interrupted' : record.status,
        // Not grants, and not trusted as a claim about the original data's provenance.
        required: [...new Set(['diagnostics', 'chat', 'extended', ...(record.receipts || []).filter(r => r.version >= 2).flatMap(receiptSources)])] });
}
export function exportHistoryRecord(record, format = 'json') {
    const r = validateRecord(record);
    return formatRecord(r, format);
}
/** Emergency exports are explicitly NOT importable session records or resumable authority. */
export function exportHistoryRecovery(record, messages, status, format = 'json') {
    const r = validateRecord(record);
    if (!Array.isArray(messages) || messages.length > HISTORY_LIMITS.messages + 2 || historyBytes(messages) > HISTORY_LIMITS.recordBytes + 2 * MAX_MESSAGE_BYTES) throw Error('HISTORY_CAPACITY');
    const base = { ...r, version: 7, receipts: [], scopeChanges: [], contextSummary: null, messages: [], status };
    validateRecord(base);
    const checked = messages.map(message => validateRecord({ ...base, messages: [message] }).messages[0]);
    if (format === 'json') return JSON.stringify({ format: 'muyu-unsaved-recovery', version: 1, record: r, messages: checked, status });
    return formatRecord({ ...r, messages: checked, status, title: 'UNSAVED RECOVERY — ' + (r.title || 'Untitled') }, format);
}
function formatRecord(r, format) {
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
