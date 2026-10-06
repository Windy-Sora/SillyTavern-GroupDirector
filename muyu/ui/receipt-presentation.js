import { receiptProtocol, receiptProtocolDescriptors } from '../actions/receipt-protocol.js';
// The wire registry owns support and presentation flags, never read/write authority.
export const receiptPresentationDescriptors = () => receiptProtocolDescriptors().map(({ version, config, technical }) => ({ version, config, technical }));
export function receiptPresentation(receipt) {
    const row = receiptProtocol(receipt?.version);
    if (!row) return { supported: false, config: false, diffs: [], fields: null };
    return { supported: true, config: row.config,
        diffs: row.technical === 'diff' ? [receipt.diff] : row.technical === 'settings-steps' ? receipt.steps.filter(step => step.kind === 'settings').map(step => step.diff) : [],
        fields: row.technical === 'profile-fields' ? receipt.fields : null };
}
