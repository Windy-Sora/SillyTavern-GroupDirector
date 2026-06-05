import { registerProvider } from '../provider-registry.js';

export function register(settings, roundState, buildDirectorWorldInfo) {
    registerProvider({
        id: 'worldInfo',
        placeholder: '{{worldInfo}}',
        enabled: () => {
            const on = settings.llmWorldInfoEnabled;
            console.log('[GroupDirector] WI Provider enabled check:', on);
            return on;
        },
        render: async (ctx) => {
            console.log('[GroupDirector] WI Provider render called. roundState.text:', JSON.stringify(roundState?.text?.substring?.(0, 200) || roundState?.text || '(empty)'));
            if (!roundState.text) {
                const members = ctx.enabledMembers || [];
                console.log('[GroupDirector] WI Provider: scanning world info for', members.length, 'members...');
                const wi = await buildDirectorWorldInfo(members);
                roundState.text = wi.text;
                roundState.entries = wi.entries;
                console.log('[GroupDirector] WI Provider scan result — text length:', wi.text?.length || 0, 'entries:', wi.entries?.length || 0);
            }
            if (!roundState.text) {
                console.log('[GroupDirector] WI Provider: no WI text after scan, returning empty');
                return { content: '' };
            }
            const wrapper = settings.llmWorldInfoWrapper || '{{worldInfo}}';
            const result = wrapper.replace('{{worldInfo}}', roundState.text);
            console.log('[GroupDirector] WI Provider final content length:', result.length);
            return { content: result };
        },
    });
}
