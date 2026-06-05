import { registerProvider } from '../provider-registry.js';

export function register(buildCharacterProfilesText) {
    registerProvider({
        id: 'character_profiles',
        placeholder: '{{character_profiles}}',
        render: () => ({ content: buildCharacterProfilesText() }),
    });
}
