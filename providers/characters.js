import { registerProvider } from '../provider-registry.js';

export function register(settings, characters, buildCharacterProfilesText) {
    registerProvider({
        id: 'characters',
        placeholder: '{{characters}}',
        render: (ctx) => {
            const members = ctx.enabledMembers || [];
            // Reuse cached result from character_profiles provider if available
            const profilesActive = settings.profileEnabled && !!(ctx._profilesText || buildCharacterProfilesText());
            return {
                content: members.map(a => {
                    const c = characters.find(c => c.avatar === a);
                    if (!c) return '';
                    if (profilesActive) {
                        // Profiles are active — suppress bulky descriptions to save tokens
                        return `- ${c.name}`;
                    }
                    const desc = c.description || '';
                    const showDesc = settings.llmCharDescMode === 'full'
                        ? desc
                        : desc.slice(0, settings.llmCharDescLength);
                    const truncated = showDesc.length < desc.length ? `${showDesc}…` : showDesc;
                    return `- ${c.name}: ${truncated}`;
                }).filter(Boolean).join('\n'),
            };
        },
    });
}
