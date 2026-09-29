import { jsonKey } from '../core/json-contract.js';

/** Sequential, non-atomic execution. A failed/uncertain step stops the remainder. */
export function createTaskBundleWriter({ draftPort, getTarget, variableWriter, configWriter, changed = () => {} }) {
    return Object.freeze({
        async apply(content) {
            if (!variableWriter || !configWriter) throw Error('WRITE_UNAVAILABLE');
            draftPort.assertFresh(content); // Preflight every step before the first mutation.
            const steps = [
                ...content.variables.map(row => ({ kind: 'variable', id: row.preview.id, status: 'not_started', result: null })),
                ...(content.settings ? [{ kind: 'settings', id: 'global-settings', status: 'not_started', result: null }] : []),
            ];
            let completed = 0;
            try {
                for (let i = 0; i < steps.length; i++) {
                    const step = steps[i];
                    if (jsonKey(getTarget()) !== jsonKey(content.target)) { step.status = 'not_executed'; break; }
                    try {
                        const result = step.kind === 'variable' ? await variableWriter.apply(content.variables[i]) :
                            await configWriter.apply({ baseline: content.settings.baseline, changes: content.settings.changes, contractVersion: 2 });
                        step.result = result;
                        step.status = result?.status || 'outcome_unknown';
                    } catch (error) {
                        step.status = ['STALE_VARIABLE_DRAFT', 'TARGET_UNAVAILABLE', 'STALE_BASELINE', 'WRITE_UNAVAILABLE', 'EMPTY_CHANGES', 'INVALID_TASK_BUNDLE'].includes(error?.message) ? 'not_executed' : 'outcome_unknown';
                    }
                    try { changed(steps); } catch { /* Observer cannot change execution. */ }
                    if (step.status !== 'applied_confirmed') break;
                    completed++;
                }
            } finally { draftPort.forget(content); }
            const firstFailure = steps.find(row => row.status !== 'applied_confirmed');
            return { status: !firstFailure ? 'applied_confirmed' : completed || firstFailure.status === 'partial' ? 'partial' : firstFailure.status === 'not_executed' ? 'not_executed' : 'outcome_unknown', steps };
        },
    });
}
