import { providers } from './provider-registry.js';

export async function renderPrompt(template, context) {
    let result = template;
    for (const provider of providers.values()) {
        if (provider.enabled && !provider.enabled(context)) continue;
        try {
            const rendered = await provider.render(context);
            const text = (rendered && typeof rendered === 'object') ? (rendered.content ?? '') : (rendered ?? '');
            result = result.split(provider.placeholder).join(text);
        } catch (e) {
            console.warn(`[GroupDirector] Provider "${provider.id}" render failed:`, e.message);
        }
    }
    return result;
}
