import { jsonKey } from '../core/json-contract.js';
import { createSourcePermissions } from '../permissions/store.js';
import { permissionSources, permissionSource } from '../permissions/contract.js';
import { parseExecutionSource } from '../permissions/contract.js';
const sourcePermission = id => permissionSource(id)?.permission || 'denied';

/** Page/connection-local grants. Never persisted or supplied by a model. */
export function createPermissions() {
    let diagnostics = false;
    const chats = new Set(), extended = new Set(), decided = new Set();
    const sources = createSourcePermissions();
    const key = target => target?.kind === 'chat' ? jsonKey(target) : null;
    const broadAllows = (kind, target) => kind === 'public' || (kind === 'diagnostics' ? diagnostics : ['chat', 'extended'].includes(kind) && !!key(target) && (kind === 'chat' ? chats : extended).has(key(target)));
    return Object.freeze({
        snapshot(target) { return { diagnostics, chat: !!key(target) && chats.has(key(target)), extended: !!key(target) && extended.has(key(target)), chatDecided: !!key(target) && decided.has(key(target)) }; },
        allows(kind, target, taskId = null) { return permissionSources.includes(kind) || parseExecutionSource(kind) ? broadAllows(sourcePermission(kind.slice(7)), target) || sources.allows(kind, target, taskId) : broadAllows(kind, target); },
        sourceGrants: target => sources.list(target).filter(source => !broadAllows(sourcePermission(source.slice(7)), target)),
        denied: (source, target, taskId) => sources.denied(source, target, taskId),
        allowsExecution: (target, taskId, providerId, providerRevision) => sources.allowsExecution(target, taskId, providerId, providerRevision),
        deniedExecution: (target, taskId, providerId, providerRevision) => sources.deniedExecution(target, taskId, providerId, providerRevision),
        decide: (request, decision, continuation) => sources.decide(request, decision, continuation),
        forgetTask: (target, taskId) => sources.forgetTask(target, taskId),
        grant(kind, target) {
            if (kind === 'diagnostics') diagnostics = true;
            else if (['chat', 'extended'].includes(kind) && key(target)) { if (decided.size >= 64 && !decided.has(key(target))) throw Error('PERMISSION_CAPACITY'); (kind === 'chat' ? chats : extended).add(key(target)); decided.add(key(target)); }
            else throw Error('INVALID_PERMISSION');
        },
        revoke(kind, target) {
            if (permissionSources.includes(kind)) { sources.revoke(kind, target); return; }
            if (kind === 'diagnostics') diagnostics = false;
            else if (['chat', 'extended'].includes(kind)) {
                (kind === 'chat' ? chats : extended).delete(key(target));
                for (const source of permissionSources) if (sourcePermission(source.slice(7)) === kind) sources.revoke(source, target);
            } else throw Error('INVALID_PERMISSION');
        },
        declineChat(target) { if (!key(target)) throw Error('INVALID_PERMISSION'); if (decided.size >= 64 && !decided.has(key(target))) throw Error('PERMISSION_CAPACITY'); decided.add(key(target)); },
        clear() { diagnostics = false; chats.clear(); extended.clear(); decided.clear(); sources.clear(); },
    });
}
