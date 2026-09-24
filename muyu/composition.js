import { startAgentRun } from './core/runtime.js';
import { createToolBroker } from './tools/broker.js';

/** Internal assembly only: no UI, model connection, host data or automatic tool grants. */
export function startMuyuRun(options) {
    return startAgentRun({ ...options, createBroker: createToolBroker });
}
