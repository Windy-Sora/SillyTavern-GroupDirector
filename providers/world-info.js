import { registerProvider } from '../provider-registry.js';

export function register(settings, roundState, buildDirectorWorldInfo) {
    registerProvider({
        id: 'worldInfo',
        placeholder: '{{worldInfo}}',
        enabled: () => settings.llmWorldInfoEnabled,
        render: async (ctx) => {
            if (!roundState.text) {
                const members = ctx.enabledMembers || [];
                const wi = await buildDirectorWorldInfo(members);
                roundState.text = wi.text;
                roundState.entries = wi.entries;
            }
            if (!roundState.text) return { content: '' };
            const wrapper = settings.llmWorldInfoWrapper || '{{worldInfo}}';
            return { content: wrapper.replace('{{worldInfo}}', roundState.text) };
        },
    });
}
