import { validateJson } from '../core/json-contract.js';
import { providerCatalog } from '../modules/providers/catalog.js';

export const PERMISSION_TOOL = 'muyu.permission.request';
export const sourceKey = id => 'source:' + id;
export const executionSource = (providerId, providerRevision) => `source:providerExecution:${providerId}:${providerRevision}`;
export function parseExecutionSource(value) {
    const match = /^source:providerExecution:([A-Za-z][A-Za-z0-9_-]{0,79}):([0-9a-f]{64}-[0-3]|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(value);
    return match ? { providerId: match[1], providerRevision: match[2] } : null;
}
export const requestableSources = Object.freeze([...providerCatalog,
    { id: 'configSettings', title: '导演、评分、Prompt与Provider超时配置（不含密钥） / Director, scoring, prompt and Provider settings (no secrets)', scope: 'global', permission: 'configuration' },
    { id: 'memoryDiagnostics', title: '记忆运行诊断（匿名统计与条件） / Memory diagnostics', scope: 'chat', permission: 'diagnostics' },
    { id: 'directorDiagnostics', title: '导演白名单配置与运行诊断 / Director diagnostics', scope: 'chat', permission: 'diagnostics' },
    { id: 'providerExecution', title: '执行指定 Provider 的代码 / Execute a named Provider', scope: 'chat', permission: 'code' },
]);
export const permissionSource = id => requestableSources.find(p => p.id === id) || null;
export const permissionSources = requestableSources.map(p => sourceKey(p.id));
export const permissionSchema = { type: 'object', properties: {
    source: { type: 'string', enum: requestableSources.map(p => p.id) },
    reason: { type: 'string', maxLength: 400 },
    providerId: { type: 'string', maxLength: 80 },
    providerRevision: { type: 'string', maxLength: 80 },
}, required: ['source', 'reason'], additionalProperties: false };
export function validatePermission(value) {
    const request = validateJson(permissionSchema, value);
    if (!request.reason.trim()) throw Error('INVALID_PERMISSION_REQUEST');
    if (request.source === 'providerExecution' ? !request.providerId || !request.providerRevision : request.providerId !== undefined || request.providerRevision !== undefined) throw Error('INVALID_PERMISSION_REQUEST');
    return request;
}
export function permissionTitle(id) { return permissionSource(id)?.title || ''; }
export function permissionDescription(r) { return r.source === 'providerExecution' ? `代码执行申请 / Code execution request: ${r.providerId} (${r.providerRevision})\n${r.reason}` : `读取授权申请 / Read permission request: ${permissionTitle(r.source)}\n${r.reason}`; }
export function permissionAnswer(r, decision) {
    if (!['task', 'chat', 'deny'].includes(decision)) throw Error('INVALID_PERMISSION_DECISION');
    return `Permission request resolved by the application: ${JSON.stringify({ source: r.source, decision, ...(r.source === 'providerExecution' ? { providerId: r.providerId, providerRevision: r.providerRevision } : {}) })}. Check tool policy before reading; do not repeat denied requests.`;
}
