import { jsonKey } from '../core/json-contract.js';
import { permissionSources, sourceKey, validatePermission, permissionSource, parseExecutionSource } from './contract.js';

/** Connection-local source grants. Only the application may commit a UI decision. */
export function createSourcePermissions() {
    const chats = new Map(), tasks = new Map(), denied = new Map();
    const executions = new Map(), executionDenials = new Map();
    const key = target => target && ['chat', 'global'].includes(target.kind) && typeof target.userKey === 'string' ? jsonKey(target) : null;
    const scope = (source, target) => {
        const spec = permissionSource(source.slice(7));
        if (!key(target) || !spec || spec.scope === 'chat' && target.kind !== 'chat') return null;
        return spec.scope === 'global' ? jsonKey({ kind: 'global', userKey: target.userKey }) : key(target);
    };
    const taskKey = (target, taskId) => taskId && key(target) ? JSON.stringify([key(target), taskId]) : null;
    const contains = (map, id, source) => !!id && !!map.get(id)?.has(source);
    const executionKey = (target, taskId, providerId, providerRevision) => taskKey(target, taskId) && JSON.stringify([taskKey(target, taskId), providerId, providerRevision]);
    return Object.freeze({
        allowsExecution(target, taskId, providerId, providerRevision) { return executions.has(executionKey(target, taskId, providerId, providerRevision)); },
        deniedExecution(target, taskId, providerId, providerRevision) { return executionDenials.has(executionKey(target, taskId, providerId, providerRevision)); },
        allows(source, target, taskId) {
            const execution = parseExecutionSource(source);
            if (execution) return !!key(target) && target.kind === 'chat' && executions.has(executionKey(target, taskId, execution.providerId, execution.providerRevision));
            return permissionSources.includes(source) && !!scope(source, target) && (contains(chats, scope(source, target), source) || contains(tasks, taskKey(target, taskId), source));
        },
        denied(source, target, taskId) { return contains(denied, taskKey(target, taskId), source); },
        list(target) { return permissionSources.filter(source => contains(chats, scope(source, target), source)); },
        decide(request, decision, continuation) {
            validatePermission({ source: request.source, reason: request.reason, ...(request.source === 'providerExecution' ? { providerId: request.providerId, providerRevision: request.providerRevision } : {}) });
            const scopeId = scope(sourceKey(request.source), request.target);
            if (!['task', 'chat', 'deny'].includes(decision) || !scopeId || !request.taskId) throw Error('INVALID_PERMISSION_DECISION');
            if (request.source === 'providerExecution') {
                if (decision === 'chat') throw Error('INVALID_PERMISSION_DECISION');
                const map = decision === 'task' ? executions : executionDenials;
                const id = executionKey(request.target, request.taskId, request.providerId, request.providerRevision);
                if (!map.has(id) && map.size >= 1024) throw Error('PERMISSION_CAPACITY');
                map.set(id, true);
                try { return continuation(); } catch (error) { map.delete(id); throw error; }
            }
            const map = decision === 'chat' ? chats : decision === 'task' ? tasks : denied;
            const id = decision === 'chat' ? scopeId : taskKey(request.target, request.taskId);
            if (!map.has(id) && map.size >= 1024) throw Error('PERMISSION_CAPACITY');
            const old = map.get(id), next = new Set(old); next.add(sourceKey(request.source)); map.set(id, next);
            // Enqueue is synchronous. No observer callback runs between commit and rollback.
            try { return continuation(); } catch (error) { if (old) map.set(id, old); else map.delete(id); throw error; }
        },
        revoke(source, target) {
            chats.get(scope(source, target))?.delete(source);
            for (const map of [tasks, denied]) for (const [id, values] of map) if (scope(source, JSON.parse(JSON.parse(id)[0])) === scope(source, target)) values.delete(source);
        },
        forgetTask(target, taskId) {
            for (const map of [tasks, denied]) for (const id of map.keys()) if (JSON.parse(id)[1] === taskId && (!target || JSON.parse(id)[0] === key(target))) map.delete(id);
            for (const map of [executions, executionDenials]) for (const id of map.keys()) if (JSON.parse(JSON.parse(id)[0])[1] === taskId && (!target || JSON.parse(JSON.parse(id)[0])[0] === key(target))) map.delete(id);
        },
        clear() { chats.clear(); tasks.clear(); denied.clear(); executions.clear(); executionDenials.clear(); },
    });
}
