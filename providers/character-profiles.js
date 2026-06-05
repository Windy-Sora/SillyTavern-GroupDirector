import { registerProvider } from '../provider-registry.js';

export function register(buildCharacterProfilesText) {
    registerProvider({
        id: 'character_profiles',
        placeholder: '{{character_profiles}}',
        render: (ctx) => {
            // Cache so characters provider can reuse without a second call
            ctx._profilesText = buildCharacterProfilesText();
            return { content: ctx._profilesText };
        },
    });
}
