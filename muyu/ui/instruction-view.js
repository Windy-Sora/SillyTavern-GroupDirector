import { INSTRUCTION_DEFAULTS, validateInstructionConfig } from '../instructions/contract.js';

/** Draft belongs to controller, not DOM; rebuilding/closing the window does not lose it. */
export function createInstructionView({ doc, settings, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, owner) => { const el = doc.createElement(tag); el.textContent = text; owner.append(el); return el; };
    const button = text => { const el = node('button', text, section); el.type = 'button'; el.className = 'menu_button'; return el; };
    const section = node('details', '', settings); section.className = 'gd-muyu-instruction-settings';
    section.open = true;
    node('summary', t('行为偏好', 'Behavior preferences'), section);
    node('p', t('影响暮羽所有任务，保存后从下一次发送生效。只补充语气、长度、表达习惯，不覆盖内置规则、工具授权和预算。不用于历史摘要生成。', 'Applies to all Muyu tasks from the next send after saving. Adds tone, length and presentation preferences; cannot override built-in rules, tool permissions or budgets. Not used for history summarization.'), section);
    const toggleLabel = node('label', t('启用补充指令（默认关闭）', 'Enable additional instructions (off by default)'), section), enabled = node('input', '', toggleLabel); enabled.type = 'checkbox';
    const label = node('label', t('补充指令', 'Additional instructions'), section), text = node('textarea', '', label); text.className = 'text_pole'; text.rows = 5;
    text.placeholder = t('例如：先给结论；通常用三条以内说明；不重复无关历史。', 'Example: lead with the conclusion; usually use at most three points; avoid unrelated history.');
    node('small', t('最多4000字符、16000 UTF-8字节；不静默截断。内容明文保存在插件设置，启用后外发给当前模型，不要填写密钥或敏感信息。草稿仅在本页保留，刷新页面会丢失。', 'Maximum 4000 characters and 16000 UTF-8 bytes; no silent truncation. Stored unencrypted in extension settings and sent to the active model when enabled. Do not enter credentials or sensitive data. Unsaved drafts survive view changes, not page reloads.'), section);
    const status = node('p', '', section); status.setAttribute('role', 'status');
    const save = button(t('保存行为偏好', 'Save behavior preferences')), discard = button(t('放弃修改', 'Discard changes')), reset = button(t('恢复默认（需保存）', 'Restore defaults (save required)'));
    const edit = () => act(() => controller.setInstructionDraft({ enabled: enabled.checked, text: text.value }));
    enabled.onchange = edit; text.oninput = edit;
    save.onclick = () => act(() => controller.saveInstructions());
    discard.onclick = () => act(() => controller.discardInstructionDraft());
    reset.onclick = () => act(() => controller.resetInstructionDraft());
    return { render(s) {
        const state = s.instructionSettings || { draft: INSTRUCTION_DEFAULTS, saved: INSTRUCTION_DEFAULTS, dirty: false, saving: false }, draft = state.draft;
        if (text.value !== draft.text) text.value = draft.text; enabled.checked = draft.enabled;
        let valid = true; try { validateInstructionConfig(draft); } catch { valid = false; }
        const bytes = new TextEncoder().encode(draft.text).length;
        status.textContent = `${draft.text.length}/4000 · ${bytes}/16000 B · ` + (valid ? state.saving ? t('保存中…', 'Saving…') : state.dirty ? t('有未保存修改', 'Unsaved changes') : t('已保存', 'Saved') : t('超出限制，未保存；请缩短内容', 'Over limit; not saved. Shorten the text.')) + ' · ' + (state.saved.enabled ? t('当前已启用', 'Currently enabled') : t('当前未启用', 'Currently disabled'));
        save.disabled = !valid || !state.dirty || state.saving || s.resetting;
        discard.disabled = !state.dirty || state.saving; reset.disabled = state.saving;
    } };
}
