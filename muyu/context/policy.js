/** Null means auto: no guessed model-token limit, only the transport byte ceiling. */
export const CONTEXT_DEFAULTS = Object.freeze({ inputTokens: 900000, recentTurns: 12, autoSummary: false });
export { MAX_REQUEST_BYTES, MAX_CONTEXT_MESSAGES, MAX_MESSAGE_BYTES } from '../core/context-limits.js';
export const MAX_MANUAL_INPUT_TOKENS = 1000000;
export function validateContextConfig(value) {
    if (!value || Object.keys(value).sort().join(',') !== 'autoSummary,inputTokens,recentTurns' ||
        !(value.inputTokens === null || Number.isSafeInteger(value.inputTokens) && value.inputTokens >= 4096 && value.inputTokens <= MAX_MANUAL_INPUT_TOKENS) ||
        !Number.isSafeInteger(value.recentTurns) || value.recentTurns < 1 || value.recentTurns > 24 || typeof value.autoSummary !== 'boolean') throw Error('INVALID_CONTEXT_CONFIG');
    return { ...value };
}
export const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
// Deliberately conservative heuristic for mixed-language JSON; never labelled actual tokens.
export const estimateTokens = value => Math.ceil(bytes(value) / 2);
export function measurePayload(payload) {
    const messages = payload.messages || [];
    return { estimatedTokens: estimateTokens(payload), requestBytes: bytes(payload), instructionBytes: payload.instructions ? bytes(payload.instructions) : messages.filter(m => m.role === 'system').reduce((sum, m) => sum + bytes(m), 0),
        toolDefinitionBytes: bytes(payload.tools || []), toolResultBytes: bytes(messages.filter(m => m.role === 'tool')),
        reasoningBytes: bytes(messages.map(m => m.reasoning_content || '')), messageBytes: bytes(messages) };
}
export function projectContext(value) {
    const keys = ['estimatedTokens', 'requestBytes', 'toolDefinitionBytes', 'toolResultBytes', 'reasoningBytes', 'messageBytes'];
    if (!value || keys.some(k => !Number.isSafeInteger(value[k]) || value[k] < 0 || value[k] > 16000000)) return null;
    const instructionBytes = value.instructionBytes ?? 0;
    if (!Number.isSafeInteger(instructionBytes) || instructionBytes < 0 || instructionBytes > 16000000) return null;
    return { ...Object.fromEntries(keys.map(k => [k, value[k]])), instructionBytes };
}

/** Counts only: never a source fingerprint, transcript or authorization. */
export function projectCoverage(value) {
    const keys = ['total', 'summarized', 'raw', 'omitted', 'excluded'];
    if (!value || !['complete', 'window', 'blocked', 'omitted'].includes(value.state) ||
        keys.some(k => !Number.isSafeInteger(value[k]) || value[k] < 0 || value[k] > 4096) ||
        value.summarized + value.raw + value.omitted + value.excluded !== value.total ||
        value.state === 'complete' && (value.omitted || value.excluded) ||
        value.state === 'blocked' && value.raw !== 0) return null;
    return { state: value.state, ...Object.fromEntries(keys.map(k => [k, value[k]])) };
}
