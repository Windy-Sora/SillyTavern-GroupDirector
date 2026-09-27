/** Keep the classic prompt editors in sync without replacing an active draft. */
export function syncConfigPromptEditors({ fields, settings, getControl, activeElement }) {
    for (const [field, control, defaultKey] of [['summaryPrompt', 'summary-prompt', 'gdDefaultPrompt'], ['critiquePrompt', 'critique-prompt', 'gdDefaultPrompt'], ['critiqueSchema', 'critique-schema', 'gdDefaultSchema'], ['profileGeneratorPrompt', 'profile-generator-prompt', 'gdDefaultPrompt']]) {
        if (!fields.includes(field)) continue;
        const editor = getControl(control);
        if (!editor?.[0] || editor[0] === activeElement) continue;
        const saved = settings[field];
        editor.val(saved || editor.data?.(defaultKey) || '');
    }
}
