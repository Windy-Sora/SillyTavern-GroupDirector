import { registerProvider } from '../provider-registry.js';

/**
 * Provider that exposes the full director ledger as structured data.
 *
 * {{directorLedger}}          → full ledger JSON string
 * {{?directorLedger:memory.location}}  → single value from the latest plan
 * {{?directorLedger:scripts.$character|}} → per-character script from latest plan
 */
export function register(settings, getDirectorHistory) {
    registerProvider({
        id: 'directorLedger',
        placeholder: '{{directorLedger}}',
        render: () => {
            const history = getDirectorHistory();
            if (!history.length) return { content: '', data: null };

            const latest = history[history.length - 1];
            return {
                content: JSON.stringify(latest, null, 2),
                data: latest,
            };
        },
    });
}
