import { CapabilityRegistry } from '../systems/capability-registry.js';

export function register({ log }) {
    CapabilityRegistry.register({
        id: 'emotion',
        displayName: 'Emotion Detection',
        description: 'Detects emotional cues in character messages and logs them.',
        schema: { intents: ['emotion', 'emotional', 'mood', 'tone'] },
        executor: async (params) => {
            log(`[Emotion] ${params.mood || params.emotion || 'neutral'} — ${params.reason || ''}`);
        },
    });
}
