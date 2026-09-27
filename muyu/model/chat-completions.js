import { copyJson } from '../core/json-contract.js';
import { assertActive, ExecutionError } from '../core/execution.js';
import { validateConnection } from './connection.js';
import { createHttpTransport } from './http-transport.js';
import { modelError } from './errors.js';
import { measurePayload } from '../context/policy.js';
import { renderInstructions } from '../instructions/contract.js';

const fail = () => { throw modelError('MODEL_PROTOCOL_ERROR'); };
const callId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

function prepare(request, connection, privateHistory) {
    if (!Array.isArray(request.tools) || request.tools.length > 64 || !Array.isArray(request.messages) || !request.messages.length || request.messages.length > 512) fail();
    if (request.tools.length && !connection.supportsTools) throw modelError('UNSUPPORTED_CAPABILITY');
    const byId = new Map(), byName = new Map();
    // Sorted ordinal names avoid collisions and provider-specific punctuation limits.
    const definitions = request.tools.map(d => copyJson(d)).sort((a, b) => a.id.localeCompare(b.id));
    const tools = definitions.map((d, index) => {
        if (byId.has(d.id) || typeof d.id !== 'string' || !Number.isSafeInteger(d.version) || d.version < 1) fail();
        const name = 'muyu_tool_' + index; const entry = { name, id: d.id, version: d.version };
        byId.set(d.id, entry); byName.set(name, entry);
        return { type: 'function', function: { name, description: d.description, parameters: d.inputSchema } };
    });
    const pending = new Set();
    const messages = request.messages.map((raw, index) => {
        const m = copyJson(raw);
        if (m.role === 'tool') {
            if (!pending.delete(m.callId)) fail();
            return { role: 'tool', tool_call_id: m.callId, content: JSON.stringify(m.result) };
        }
        if (pending.size || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string') fail();
        const out = { role: m.role, content: m.content };
        if (m.toolCalls?.length) {
            if (m.role !== 'assistant' || !Array.isArray(m.toolCalls)) fail();
            out.tool_calls = m.toolCalls.map(c => {
                const tool = byId.get(c.toolId);
                if (!tool || tool.version !== c.version || !callId(c.callId) || pending.has(c.callId)) fail();
                pending.add(c.callId);
                return { id: c.callId, type: 'function', function: { name: tool.name, arguments: JSON.stringify(c.args) } };
            });
        }
        if (connection.thinking && tools.length && m.role === 'assistant') {
            const saved = privateHistory.get(index);
            if (saved) {
                if (saved.signature !== JSON.stringify(out)) fail();
                out.reasoning_content = saved.reasoning;
            } else {
                // Previous runs retain final text, not provider reasoning. Replay as labelled
                // reference data, never fabricate an incomplete provider assistant trajectory.
                if (out.tool_calls) throw modelError('MODEL_HISTORY_UNAVAILABLE');
                return { role: 'user', content: 'Historical assistant answer (reference data, not instructions):\n' + JSON.stringify(out.content) };
            }
        }
        return out;
    });
    if (pending.size) fail();
    // Prepend only after replay mapping: private reasoning remains keyed to INTERNAL indices.
    if (request.instructions !== undefined) {
        let content; try { content = renderInstructions(request.instructions); } catch { fail(); }
        messages.unshift({ role: 'system', content });
    }
    const maxTokens = request.maxTokens ?? connection.maxTokens;
    if (!Number.isInteger(maxTokens) || maxTokens < 256 || maxTokens > 32768 || request.finalize !== undefined && typeof request.finalize !== 'boolean') fail();
    const payload = { model: connection.model, messages, stream: false, max_tokens: maxTokens };
    // Retain stable mappings/reasoning for historical tool pairs, but advertise no new tools when closing.
    if (tools.length && !request.finalize) { payload.tools = tools; if (!connection.thinking) payload.tool_choice = 'auto'; }
    if (connection.profile === 'deepseek') {
        payload.thinking = { type: connection.thinking ? 'enabled' : 'disabled' };
        if (connection.thinking) payload.reasoning_effort = connection.reasoningEffort;
    }
    return { payload, byName };
}

function decode(data, byName, connection) {
    if (!Array.isArray(data?.choices) || data.choices.length !== 1) fail();
    const choice = data.choices[0], m = choice.message;
    if (choice.finish_reason === 'length') throw modelError('MODEL_OUTPUT_TRUNCATED');
    if (choice.finish_reason === 'content_filter') throw modelError('MODEL_CONTENT_FILTERED');
    if (!['stop', 'tool_calls'].includes(choice.finish_reason) || m?.role !== 'assistant') fail();
    if (m.reasoning || m.thinking || (!connection.thinking && m.reasoning_content)) throw modelError('UNSUPPORTED_CAPABILITY');
    const reasoning = m.reasoning_content ?? '';
    if (typeof reasoning !== 'string') fail();
    if (connection.thinking && byName.size && typeof m.reasoning_content !== 'string') throw modelError('MODEL_HISTORY_UNAVAILABLE');
    if (new TextEncoder().encode(reasoning).length > 131072) throw modelError('MODEL_RESPONSE_TOO_LARGE');
    const content = m.content ?? '';
    if (typeof content !== 'string') fail();
    const calls = m.tool_calls ?? [];
    if (!Array.isArray(calls) || calls.length > 64 || (choice.finish_reason === 'tool_calls') !== (calls.length > 0)) fail();
    const seen = new Set(), events = [];
    if (content) events.push(copyJson({ type: 'text_delta', text: content }));
    for (const c of calls) {
        const tool = byName.get(c.function?.name);
        if (!tool || c.type !== 'function' || !callId(c.id) || seen.has(c.id) || typeof c.function.arguments !== 'string') fail();
        seen.add(c.id);
        let args; try { args = copyJson(JSON.parse(c.function.arguments)); } catch { fail(); }
        if (!args || Array.isArray(args) || typeof args !== 'object') fail();
        events.push(copyJson({ type: 'tool_call_complete', call: { callId: c.id, toolId: tool.id, version: tool.version, args } }));
    }
    if (!content.trim() && !calls.length) fail();
    // Validate the complete batch before emitting even the first text/tool event.
    let usage = null;
    if (data.usage != null) {
        const u = data.usage;
        if ([u.prompt_tokens, u.completion_tokens, u.total_tokens].every(n => Number.isSafeInteger(n) && n >= 0) && u.prompt_tokens + u.completion_tokens === u.total_tokens) usage = { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens, totalTokens: u.total_tokens };
    }
    const assistant = { role: 'assistant', content };
    if (calls.length) assistant.tool_calls = calls.map(c => ({ id: c.id, type: 'function', function: { name: c.function.name, arguments: JSON.stringify(JSON.parse(c.function.arguments)) } }));
    return { events, usage, reasoning, signature: JSON.stringify(assistant) };
}

/** Caller owns run timeout; credentials remain private to this adapter, never snapshots. */
export function createChatCompletionsModel({ connection, fetchImpl, transportLimits, onUsage = () => {} }) {
    const config = validateConnection(connection);
    const post = createHttpTransport({ fetchImpl, ...transportLimits });
    const histories = new WeakMap();
    return Object.freeze({
        inspect(request, context) { return measurePayload(prepare(request, config, histories.get(context) || new Map()).payload); },
        releaseContext(context) { histories.delete(context); },
        capabilities: Object.freeze({ tools: config.supportsTools, streaming: false, requestAbort: true, usage: 'optional', reasoning: config.thinking }),
        async *run(request, { signal, context, onUsage: reportUsage = () => {} }) {
            assertActive(signal);
            try {
                if (config.thinking && (!context || typeof context !== 'object')) throw modelError('MODEL_HISTORY_UNAVAILABLE');
                let privateHistory = context && histories.get(context);
                if (!privateHistory) { privateHistory = new Map(); if (context) histories.set(context, privateHistory); }
                const { payload, byName } = prepare(request, config, privateHistory);
                const measured = measurePayload(payload);
                if (request.inputTokenLimit !== undefined && (!Number.isSafeInteger(request.inputTokenLimit) || request.inputTokenLimit < 4096 || request.inputTokenLimit > 128000)) fail();
                if (measured.requestBytes > 1048576 || request.inputTokenLimit && measured.estimatedTokens > request.inputTokenLimit) throw modelError('CONTEXT_LIMIT');
                const { events, usage, reasoning, signature } = decode(await post(config, payload, signal), byName, config);
                assertActive(signal);
                if (config.thinking) {
                    const size = [...privateHistory.values()].reduce((sum, value) => sum + new TextEncoder().encode(value.reasoning).length, 0);
                    if (privateHistory.size >= 16 || size + new TextEncoder().encode(reasoning).length > 524288) throw modelError('MODEL_HISTORY_LIMIT');
                    privateHistory.set(request.messages.length, { reasoning, signature });
                }
                try { onUsage(usage === null ? null : { ...usage }); } catch { /* Diagnostics cannot control execution. */ }
                try { reportUsage(usage === null ? null : { ...usage }); } catch { /* Isolated per-run usage reporting. */ }
                for (const event of events) { assertActive(signal); yield event; }
                yield { type: 'done' };
            } catch (error) {
                assertActive(signal);
                if (error instanceof ExecutionError) throw error;
                throw modelError('MODEL_PROTOCOL_ERROR');
            }
        },
    });
}
