import { startAgentRun } from './core/runtime.js';
import { createToolBroker } from './tools/broker.js';
import { measurePayload, validateContextConfig } from './context/policy.js';
import { summaryMessage } from './context/planner.js';
import { compactionRequest, collectSummary } from './context/compaction.js';
import { validateInstructions } from './instructions/contract.js';
import { interactionPort } from './interactions/contract.js';
import { receiptContext } from './actions/receipts.js';

/** Internal assembly only: no UI, model connection, host data or automatic tool grants. */
export function startMuyuRun(options) {
    return startAgentRun({ ...options, applicationContext: receiptContext(options.applicationResults || []), interactionPort, createBroker: args => createToolBroker({ ...args, externalTools: ['muyu.provider.execute', 'muyu.web.search'] }), instructionPort: { validate: validateInstructions }, contextPort: { measurePayload, validateContextConfig, summaryMessage, compactionRequest, collectSummary } });
}
