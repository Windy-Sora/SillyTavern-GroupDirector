import { registerProvider } from '../provider-registry.js';

export function register(settings, getDirectorHistory) {
    registerProvider({
        id: 'previousPlan',
        placeholder: '{{previousPlan}}',
        render: () => {
            const history = getDirectorHistory();
            if (!settings.llmHistoryEnabled || !settings.llmScriptContinuity || !history.length) return { content: '' };
            if (settings.llmScriptContinuityMode === 'history') return { content: '' };
            const lastPlan = history[history.length - 1];
            const wrapper = settings.llmScriptContinuityWrapper || '{{previousPlan}}';
            return { content: wrapper.replace('{{previousPlan}}', JSON.stringify(lastPlan, null, 2)) };
        },
    });

    registerProvider({
        id: 'previousPlans',
        placeholder: '{{previousPlans}}',
        render: () => {
            const history = getDirectorHistory();
            if (!settings.llmHistoryEnabled || !settings.llmScriptContinuity || !history.length) return { content: '' };
            if (settings.llmScriptContinuityMode !== 'history') return { content: '' };
            const count = settings.llmScriptContinuityCount > 0
                ? Math.min(settings.llmScriptContinuityCount, history.length)
                : history.length;
            const plansJson = JSON.stringify(history.slice(-count), null, 2);
            const wrapper = settings.llmScriptContinuityHistoryWrapper || '{{previousPlans}}';
            return { content: wrapper.replace('{{previousPlans}}', plansJson) };
        },
    });
}
