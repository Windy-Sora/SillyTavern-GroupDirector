import { projectServiceDiagnostics } from '../services/diagnostics.js';
const BASE = '/api/plugins/gd-muyu-history';
const ERRORS = new Set(['HISTORY_IDENTITY_UNAVAILABLE', 'SERVICE_STORAGE_PERMISSION', 'SERVICE_STORAGE_FULL', 'SERVICE_STORAGE_UNAVAILABLE', 'SERVICE_CHECK_CONFIRMATION_REQUIRED', 'SERVICE_CHECK_BUSY']);
/** Independent local service checks: no model calls, search keys or arbitrary URLs. */
export function createServicesPort({ fetcher = globalThis.fetch, getHeaders = () => ({}) } = {}) {
    const pending = new Set();
    async function request(route, body) {
        const abort = new AbortController(); pending.add(abort);
        const timer = setTimeout(() => abort.abort(), 10000);
        let reader, finished = false;
        try {
            const response = await fetcher(BASE + route, { method: body ? 'POST' : 'GET',
                headers: { ...getHeaders(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {}), signal: abort.signal,
                credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
            if (response.status === 404) throw Error('SERVICE_MISSING');
            if (!(response.headers.get('content-type') || '').includes('application/json') || !response.body) throw Error('SERVICE_UNAVAILABLE');
            reader = response.body.getReader(); let bytes = 0, text = ''; const decoder = new TextDecoder();
            while (true) {
                const part = await reader.read(); if (abort.signal.aborted) throw Error('SERVICE_UNAVAILABLE');
                if (part.done) { finished = true; break; }
                bytes += part.value.byteLength; if (bytes > (route === '/service/diagnostics' ? 65536 : 16384)) throw Error('SERVICE_UNAVAILABLE');
                text += decoder.decode(part.value, { stream: true });
            }
            let value; try { value = JSON.parse(text + decoder.decode()); } catch { throw Error('SERVICE_UNAVAILABLE'); }
            if (!response.ok) throw Error(ERRORS.has(value?.error) ? value.error : 'SERVICE_UNAVAILABLE');
            return value;
        } finally {
            clearTimeout(timer); pending.delete(abort);
            if (reader) { if (!finished) await reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
    }
    const number = value => Number.isSafeInteger(value) && value > 0 && value <= 1073741824;
    return {
        async check() {
            let raw;
            try { raw = await request('/service/status'); }
            catch (error) {
                if (error.message !== 'SERVICE_MISSING') throw Error(ERRORS.has(error.message) ? error.message : 'SERVICE_UNAVAILABLE');
                try { const legacy = await request('/health'); if (legacy?.version === 1) return { status: 'legacy' }; }
                catch (cause) { if (cause.message !== 'SERVICE_MISSING') throw Error('SERVICE_UNAVAILABLE'); }
                return { status: 'missing' };
            }
            if (raw?.version !== 1 || typeof raw.serviceVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(raw.serviceVersion) || raw.serviceVersion.length > 30 ||
                !raw.capabilities || typeof raw.capabilities !== 'object' || Array.isArray(raw.capabilities) || !raw.limits || typeof raw.limits !== 'object' || Array.isArray(raw.limits) || !['records', 'recordBytes', 'totalBytes', 'messages'].every(key => number(raw.limits[key]))) return { status: 'incompatible' };
            return { status: 'available', serviceVersion: raw.serviceVersion,
                capabilities: Object.fromEntries(['history', 'search', 'storageCheck', 'diagnostics'].map(key => [key, raw.capabilities[key] === 1])),
                limits: Object.fromEntries(['records', 'recordBytes', 'totalBytes', 'messages'].map(key => [key, raw.limits[key]])) };
        },
        async checkStorage() {
            let raw; try { raw = await request('/service/storage-check', { confirm: true }); }
            catch (error) { throw Error(ERRORS.has(error.message) ? error.message : 'SERVICE_UNAVAILABLE'); }
            if (raw?.version !== 1 || !['ok', 'failed'].includes(raw.status) || !['prepare', 'write', 'read', 'cleanup', 'complete'].includes(raw.stage) ||
                !['not_needed', 'complete', 'failed'].includes(raw.cleanup) || raw.status === 'ok' && (raw.stage !== 'complete' || raw.cleanup !== 'complete') ||
                raw.status === 'failed' && !ERRORS.has(raw.error)) throw Error('SERVICE_INCOMPATIBLE');
            return { status: raw.status, stage: raw.stage, cleanup: raw.cleanup, ...(raw.status === 'failed' ? { error: raw.error } : {}) };
        },
        async diagnostics() {
            let raw; try { raw = await request('/service/diagnostics'); }
            catch (error) { throw Error(ERRORS.has(error.message) ? error.message : error.message === 'SERVICE_MISSING' ? 'SERVICE_INCOMPATIBLE' : 'SERVICE_UNAVAILABLE'); }
            return projectServiceDiagnostics(raw);
        },
        async clearDiagnostics() {
            let raw; try { raw = await request('/service/diagnostics/clear', { confirm: true }); }
            catch (error) { throw Error(ERRORS.has(error.message) ? error.message : 'SERVICE_UNAVAILABLE'); }
            if (raw?.version !== 1 || raw.cleared !== true) throw Error('SERVICE_INCOMPATIBLE');
        },
        async readDiagnostics(selector) {
            if (selector && !/^recent:([1-9]|[1-4]\d|50)$/.test(selector)) throw Error('INVALID_SELECTOR');
            const data = await this.diagnostics();
            const notice = '仅当前账户最近30分钟的有界暮羽服务错误分类，不是完整酒馆／CMD日志；重启或清空后不可恢复。不含正文、密钥、原始异常。分类不证明具体根因，空记录不证明服务从未失败。';
            if (!selector) return { text: JSON.stringify({ count: data.records.length, capacity: data.capacity, retentionMinutes: data.retentionMinutes, selectors: 'recent:N (1-50)', notice }), limited: false };
            const records = data.records.slice(-Number(selector.slice(7)));
            return { text: JSON.stringify({ records, notice }), limited: records.length < data.records.length };
        },
        cancel() { for (const abort of pending) abort.abort(); },
    };
}
