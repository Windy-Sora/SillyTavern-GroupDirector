import { assertActive, ExecutionError } from '../core/execution.js';
import { modelError, httpError } from './errors.js';

/** No racing away from fetch/read/cancel: the caller's drain must represent all local work. */
export function createHttpTransport({ fetchImpl = globalThis.fetch, maxRequestBytes = 1048576, maxResponseBytes = 262144 } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('Missing fetch');
    for (const n of [maxRequestBytes, maxResponseBytes]) if (!Number.isSafeInteger(n) || n < 1 || n > 1048576) throw new TypeError('Invalid transport limit');
    return async function post(connection, payload, signal) {
        assertActive(signal);
        const body = JSON.stringify(payload);
        if (new TextEncoder().encode(body).length > maxRequestBytes) throw modelError('MODEL_REQUEST_TOO_LARGE');
        let reader, cancelPromise, finished = false;
        const cancel = () => {
            if (!reader || cancelPromise) return;
            try { cancelPromise = Promise.resolve(reader.cancel()).catch(() => {}); }
            catch { cancelPromise = Promise.resolve(); }
        };
        try {
            const response = await fetchImpl(connection.endpoint, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${connection.apiKey}` },
                body, signal, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
            });
            if (response.body) reader = response.body.getReader();
            signal.addEventListener('abort', cancel, { once: true });
            assertActive(signal);
            if (!response.ok) throw httpError(response.status);
            if (!reader || !(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) throw modelError('MODEL_PROTOCOL_ERROR');
            const decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0, text = '';
            while (true) {
                const part = await reader.read(); assertActive(signal);
                if (part.done) { finished = true; break; }
                bytes += part.value.byteLength;
                if (bytes > maxResponseBytes) throw modelError('MODEL_RESPONSE_TOO_LARGE');
                text += decoder.decode(part.value, { stream: true });
            }
            text += decoder.decode();
            try { return JSON.parse(text); } catch { throw modelError('MODEL_PROTOCOL_ERROR'); }
        } catch (error) {
            assertActive(signal);
            if (error instanceof ExecutionError) throw error;
            throw modelError('MODEL_NETWORK_ERROR');
        } finally {
            signal.removeEventListener('abort', cancel);
            if (!finished) cancel();
            if (cancelPromise) await cancelPromise;
            reader?.releaseLock();
        }
    };
}
