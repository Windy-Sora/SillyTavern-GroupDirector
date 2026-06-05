import { providers } from './provider-registry.js';

export async function renderPrompt(template, context) {
    let result = template;
    for (const provider of providers.values()) {
        if (provider.enabled && !provider.enabled(context)) continue;
        try {
            const rendered = await provider.render(context);
            // Support both { content } object and bare string return
            const text = (rendered && typeof rendered === 'object') ? (rendered.content ?? '') : (rendered ?? '');
            // Global replace — same placeholder may appear multiple times
            result = result.split(provider.placeholder).join(text);
        } catch (e) {
            console.warn(`[GroupDirector] Provider "${provider.id}" render failed:`, e.message);
        }
    }
    return result;
}
