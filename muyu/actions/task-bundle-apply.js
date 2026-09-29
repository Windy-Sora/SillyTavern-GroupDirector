import { createApprovedActions } from './coordinator.js';

/** One UI approval is bound to one exact bundle artifact and consumed once. */
export function createTaskBundleActions({ getArtifact, validate, getTarget, writer, changed = () => {} }) {
    return createApprovedActions({ getArtifact, getTarget, changed, contract: {
        idPrefix: 'bundle-apply:', available: () => !!writer,
        matchesArtifact: artifact => artifact.kind === 'task-bundle' && artifact.content?.module === 'task-bundle',
        validate, execute: record => writer.apply(record.content),
        resultStatus: result => ['applied_confirmed', 'partial', 'outcome_unknown', 'not_executed'].includes(result?.status) ? result.status : 'outcome_unknown',
        notExecuted: error => ['TARGET_UNAVAILABLE', 'STALE_TASK_BUNDLE', 'ACTION_STALE', 'WRITE_UNAVAILABLE'].includes(error?.message),
    } });
}
