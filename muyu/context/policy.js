/** Local input targets, not a claim about the remote model's context window. */
export const CONTEXT_DEFAULTS = Object.freeze({ inputTokens: 32000, recentTurns: 12, autoSummary: false });
export function validateContextConfig(value) {
    if (!value || Object.keys(value).sort().join(',') !== 'autoSummary,inputTokens,recentTurns' ||
        !Number.isSafeInteger(value.inputTokens) || value.inputTokens < 4096 || value.inputTokens > 128000 ||
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
