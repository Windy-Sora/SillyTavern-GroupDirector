/**
 * PostSpeech Agent — generates multimodal policy after each character message.
 *
 * Pipeline: context → prompt → call
 *
 * Output (JSON): { intents: [...], timing: { mode: 'immediate'|'deferred', delay: number } }
 *
 * Does NOT know ST internals, does NOT know capability implementations.
 * Only outputs abstract intents for the Execution Engine to resolve.
 */
import { CapabilityRegistry } from '../systems/capability-registry.js';

export const DEFAULT_PROMPT = `You are a multimodal policy generator. Based on the character's message and the conversation context, decide which sensory capabilities should be activated for the user.

━━━ Available Capabilities ━━━
Each capability lists its params and when to use it. Only activate those whose "When" condition matches the current message.

{{capabilityList}}

━━━ Context ━━━
Recent messages:
{{newRecentMessages}}

Character who just spoke:
Name: {{speakerName}}
Description: {{speakerDescription}}
They said: "{{speakerMessage}}"

Current scene:
{{worldInfo}}

━━━ ━━━━━━━━━━━━━━

Guidelines:
- Only activate capabilities that are LISTED above and make sense for this message.
- "tts" → adjust voice emotion/tone based on what the character is feeling
- "image" → request an image if the scene describes striking visual elements
- "emotion" → if the message contains strong emotional cues, describe the character's emotional expression
- Output 0-2 intents per message. Do NOT activate anything if nothing fits.
- If the message is short or purely functional (e.g. "Yes.", "OK."), skip.

Reply with ONLY a JSON object, no prose, no code fences:
{
  "intents": [
    {
      "type": "capability-id",
      "params": { "key": "value" }
    }
  ],
  "timing": { "mode": "immediate" }
}`;

export function createPostSpeechAgent({ renderPrompt, log }) {
    return {
        id: 'post-speech',
        displayName: 'PostSpeech Policy',
        contextAccess: ['chat', 'recentMessages', 'characters', 'group', 'settings', 'worldInfoText',
            'speakerMessage', 'speakerName', 'speakerDescription'],
        pipelineOrder: ['context', 'prompt', 'call'],
        pipeline: {
            async context(_input, _ctx, pool, settings) {
                const msg = pool.speakerMessage?.() ?? '';
                const speakerName = pool.speakerName?.() ?? '';
                const speakerDesc = pool.speakerDescription?.() ?? '';
                const capabilities = CapabilityRegistry.listEnabled();

                // Build per-capability decision guidance
                const capListParts = [];
                for (const cap of capabilities) {
                    let text = `- ${cap.id}: ${cap.description || cap.displayName}\n`;
                    // Param schema hints
                    if (cap.schema?.params) {
                        const paramDescs = [];
                        for (const [k, def] of Object.entries(cap.schema.params)) {
                            let pd = `  ${k}`;
                            if (def.values) pd += `(${def.values.join('/')})`;
                            if (def.required) pd += '*';
                            if (def.description) pd += `: ${def.description}`;
                            paramDescs.push(pd);
                        }
                        if (paramDescs.length) text += `  Params: ${paramDescs.join(', ')}\n`;
                    }
                    // Decision guidance
                    if (cap.promptHint) text += `  When: ${cap.promptHint}\n`;
                    capListParts.push(text);
                }

                return {
                    speakerMessage: msg,
                    speakerName,
                    speakerDescription: speakerDesc,
                    capabilityList: capabilities.length > 0
                        ? capListParts.join('\n')
                        : '(none available)',
                    hasCapabilities: capabilities.length > 0,
                };
            },

            async prompt(ctx, _state, pool, settings) {
                if (!ctx.hasCapabilities) return null;

                const template = settings.postSpeechPrompt || DEFAULT_PROMPT;

                let filled = template
                    .replace(/\{\{speakerName\}\}/g, ctx.speakerName)
                    .replace(/\{\{speakerMessage\}\}/g, ctx.speakerMessage)
                    .replace(/\{\{speakerDescription\}\}/g, ctx.speakerDescription)
                    .replace(/\{\{capabilityList\}\}/g, ctx.capabilityList);

                // Resolve Provider placeholders via renderPrompt
                // Passthrough ST-native placeholders ({{User}}, {{char}}, etc.) — they are
                // substituted later by ST's own pipeline, not by Group Director.
                filled = await renderPrompt(filled, {}, {
                    passthrough: ['User', 'user', 'char', 'original'],
                });

                return filled;
            },
        },

        /**
         * Quick parse of LLM response — returns policy object or null.
         * Called by the orchestrator, not part of the pipeline.
         */
        parseResponse(raw) {
            if (!raw) return null;
            try {
                return JSON.parse(raw);
            } catch (e) {
                // Try extracting JSON from mixed text
                const start = raw.indexOf('{');
                const end = raw.lastIndexOf('}');
                if (start >= 0 && end > start) {
                    try { return JSON.parse(raw.slice(start, end + 1)); } catch (_) {}
                }
                return null;
            }
        },
    };
}
