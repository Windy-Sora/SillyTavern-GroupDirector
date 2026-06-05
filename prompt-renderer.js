import { providers } from './provider-registry.js';

export async function renderPrompt(template, context) {
    let result = template;
    for (const provider of providers.values()) {
        const hasPlaceholder = result.includes(provider.placeholder);
        if (provider.enabled && !provider.enabled(context)) {
            if (hasPlaceholder) console.log(`[GroupDirector] renderPrompt: "${provider.id}" skipped by enabled()=false (placeholder in template: yes)`);
            continue;
        }
        try {
            const rendered = await provider.render(context);
            const text = (rendered && typeof rendered === 'object') ? (rendered.content ?? '') : (rendered ?? '');
            const beforeLen = result.length;
            result = result.split(provider.placeholder).join(text);
            if (hasPlaceholder || text) {
                console.log(`[GroupDirector] renderPrompt: "${provider.id}" → placeholder ${hasPlaceholder ? 'replaced' : 'absent'}, content: ${text.length} chars, template: ${beforeLen}→${result.length} chars`);
            }
        } catch (e) {
            console.warn(`[GroupDirector] Provider "${provider.id}" render failed:`, e.message);
        }
    }
    return result;
}
