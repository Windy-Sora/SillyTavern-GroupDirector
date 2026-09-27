import { createToolRegistry } from '../../tools/registry.js';
import { PERMISSION_TOOL, permissionSchema, validatePermission } from '../../permissions/contract.js';

export function createPermissionModule() {
    const registry = createToolRegistry();
    registry.register({ id: PERMISSION_TOOL, version: 1,
        description: 'For ordinary read tools, call the intended tool directly: the host pauses and requests the exact missing source, then resumes that same call after approval. Do not request a read source yourself. Use this control tool ONLY to request providerExecution for a specific Provider id/revision before executing its code; send it ALONE. Provider execution can modify state, use the network or incur costs, and approval applies only to that Provider/version and task. PERMISSION_REQUEST_INVALID is not a user denial. On denial do not repeat or bypass the request.',
        inputSchema: permissionSchema, outputSchema: permissionSchema, scope: 'global', effect: 'read', dataClasses: ['public-knowledge'], confirmation: 'policy', resourceKeys: [], timeoutMs: 1000, retryPolicy: { kind: 'none', maxAttempts: 1 } });
    registry.seal();
    return { registry, handlers: { [PERMISSION_TOOL]: validatePermission }, forgetRun() {}, dispose() {} };
}
