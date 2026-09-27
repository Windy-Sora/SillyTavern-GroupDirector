import { executionSource, parseExecutionSource, permissionSource, sourceKey } from '../permissions/contract.js';
import { fieldDefinition } from '../config/registry.js';

function settingsSources(fields) {
    try { return [...new Set(fields.map(id => fieldDefinition(id).domain === 'memory' ? 'source:memoryConfig' : 'source:configSettings'))]; }
    catch { return null; }
}

// One application contract for tool effects, required grants and history dependencies.
// Tool definitions own wire schemas; handlers own business validation.
const capabilities = Object.freeze({
    ...Object.fromEntries(['muyu.provider.list', 'muyu.provider.discover', 'muyu.knowledge.list', 'muyu.knowledge.read', 'muyu.config.contract', 'muyu.context.list', 'muyu.context.read', 'muyu.interaction.ask', 'muyu.permission.request', 'muyu.settings.catalog', 'muyu.settings.contract'].map(id => [id, { effect: 'read', sources: () => [] }])),
    'muyu.settings.read': { effect: 'read', sources: args => settingsSources(args.fields || []) },
    'muyu.settings.preview': { effect: 'read', sources: args => {
        const fields = Object.keys(args.changes || {}), sources = settingsSources(fields);
        return sources && fields.includes('memoryMaxEntries') ? [...sources, 'source:memoryDiagnostics'] : sources;
    } },
    'muyu.provider.read': { effect: 'read', sources: args => permissionSource(args.id) ? [sourceKey(args.id)] : null },
    'muyu.provider.execute': { effect: 'external', sources: args => [executionSource(args.id, args.revision)] },
    'muyu.provider.result': { effect: 'read', sources: args => [executionSource(args.id, args.revision)] },
    'muyu.memory.inspect': { effect: 'read', sources: () => ['source:memoryConfig', 'source:memoryDiagnostics'] },
    'muyu.director.inspect': { effect: 'read', sources: () => ['source:directorDiagnostics'] },
    'muyu.config.preview': { effect: 'read', sources: () => ['source:memoryConfig'] },
});

export function requiredSources(toolId, args = {}) {
    return capabilities[toolId]?.sources(args) ?? null;
}
export function sourceTargetValid(source, target, providerPort, storedResult = false) {
    const execution = parseExecutionSource(source);
    if (execution) {
        if (target?.kind !== 'chat') return false;
        if (storedResult) return true;
        const descriptor = providerPort?.describe(execution.providerId, execution.providerRevision);
        return !!descriptor && descriptor.missingContext?.length === 0;
    }
    const spec = permissionSource(source.replace(/^source:/, ''));
    return !!spec && !!target && (spec.scope === 'global' || target.kind === 'chat');
}
function sourceDenied(source, target, taskId, permissions) {
    const execution = parseExecutionSource(source);
    return execution ? permissions.deniedExecution(target, taskId, execution.providerId, execution.providerRevision) : permissions.denied(source, target, taskId);
}
export function permissionRequestAllowed(args, target, taskId, permissions, providerPort) {
    const source = args.source === 'providerExecution' ? executionSource(args.providerId, args.providerRevision) : sourceKey(args.source);
    return sourceTargetValid(source, target, providerPort) && !sourceDenied(source, target, taskId, permissions) && !permissions.allows(source, target, taskId);
}
export function permissionRequestAlreadyGranted(args, target, taskId, permissions, providerPort) {
    const source = args.source === 'providerExecution' ? executionSource(args.providerId, args.providerRevision) : sourceKey(args.source);
    return sourceTargetValid(source, target, providerPort) && permissions.allows(source, target, taskId);
}
export function permissionApprovalCurrent(request, providerPort) {
    return sourceTargetValid(request.source === 'providerExecution' ? executionSource(request.providerId, request.providerRevision) : sourceKey(request.source), request.target, providerPort);
}
export function toolAvailableInMode(toolId, mode) {
    return mode === 'assistant' || !['muyu.provider.execute', 'muyu.provider.result'].includes(toolId);
}
export function assistantToolAccess(definition, args, target, taskId, permissions, providerPort) {
    const contract = capabilities[definition.id];
    if (!contract || contract.effect !== definition.effect) return { decision: 'policy_forbidden', required: [] };
    const required = requiredSources(definition.id, args);
    if (!required) return { decision: 'invalid_request', required: [] };
    if (required.some(source => !sourceTargetValid(source, target, providerPort, definition.id === 'muyu.provider.result'))) return { decision: 'target_unavailable', required: [] };
    if (required.some(source => sourceDenied(source, target, taskId, permissions))) return { decision: 'user_denied', required: [] };
    const missingSources = required.filter(source => !permissions.allows(source, target, taskId));
    if (missingSources.length) return { decision: 'permission_required', required: [], missingSources };
    return { decision: true, required };
}
