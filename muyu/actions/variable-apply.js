import { createApprovedActions } from './coordinator.js';

/** One bounded variable draft is the initial task manifest; future manifests can add ordered domains. */
export function createVariableActions({ getArtifact, validate, getTarget, writer, changed = () => {} }) {
    return createApprovedActions({ getArtifact, getTarget, changed, contract: {
        idPrefix: 'variable-apply:', available: () => !!writer,
        matchesArtifact: artifact => artifact.kind === 'variable-draft' && !!artifact.content?.preview?.diff?.length,
        validate, execute: record => writer.apply(record.content),
        resultStatus: result => ['applied_confirmed', 'partial', 'outcome_unknown'].includes(result?.status) ? result.status : 'outcome_unknown',
        notExecuted: error => ['TARGET_UNAVAILABLE', 'STALE_VARIABLE_DRAFT', 'VARIABLE_ID_COLLISION', 'VARIABLE_NOT_FOUND',
            'VARIABLE_VALUE_OUT_OF_RANGE', 'WRITE_UNAVAILABLE', 'ACTION_STALE'].includes(error?.message),
    } });
}
