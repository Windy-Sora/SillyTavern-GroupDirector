/** View only: choices fill a draft; only explicit submission can continue the task. */
export function createInteractionView({ doc, parent, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, owner) => { const el = doc.createElement(tag); el.textContent = text; owner.append(el); return el; };
    const root = node('section', '', parent); root.className = 'gd-muyu-interaction'; root.hidden = true;
    const heading = node('strong', t('暮羽需要你补充一下', 'Muyu needs your input'), root);
    const question = node('p', '', root), choices = node('div', '', root);
    const label = node('label', t('你的回答', 'Your answer'), root), input = node('textarea', '', label); input.className = 'text_pole'; input.rows = 2; input.maxLength = 2000;
    const actions = node('div', '', root); actions.className = 'gd-muyu-actions';
    const button = text => { const el = node('button', text, actions); el.type = 'button'; el.className = 'menu_button'; return el; };
    const submit = button(t('回答并继续', 'Answer and continue')), cancel = button(t('取消澄清', 'Cancel clarification'));
    const status = node('p', '', root); status.setAttribute('role', 'status');
    const hint = node('small', t('回答仅补充需求，不授予权限。', 'Answers clarify intent, never grant permission.'), root);
    let current = null, signature = '';
    input.oninput = () => act(() => controller.setInteractionDraft(current.id, input.value));
    submit.onclick = () => act(() => controller.answerInteraction(current.id));
    cancel.onclick = () => act(() => controller.cancelInteraction(current.id));
    return { render(s) {
        current = s.interaction?.kind === 'permission' ? null : s.interaction; root.hidden = !current; if (!current) { submit.disabled = cancel.disabled = input.disabled = true; return; }
        question.textContent = current.question;
        const pending = current.status === 'pending';
        root.hidden = current.status === 'answered';
        heading.hidden = question.hidden = hint.hidden = label.hidden = choices.hidden = actions.hidden = !pending;
        input.disabled = !pending || s.resetting;
        if (input.value !== current.draft) input.value = current.draft;
        submit.disabled = !pending || s.busy || s.resetting || !current.draft.trim(); cancel.disabled = !pending || s.resetting;
        const next = JSON.stringify([current.id, current.options, s.resetting]);
        if (signature !== next) {
            signature = next; choices.replaceChildren();
            for (const value of current.options) {
                const id = current.id, choice = node('button', value, choices); choice.type = 'button'; choice.className = 'menu_button'; choice.disabled = s.resetting;
                choice.onclick = () => act(() => { controller.setInteractionDraft(id, value); input.focus?.(); });
            }
        }
        const labels = { pending: t('等待你的回答', 'Waiting for your answer'), answered: t('已回答', 'Answered'), cancelled: t('已取消', 'Cancelled'), expired: t('已失效，请重新发起任务', 'Expired; start a new task') };
        status.textContent = labels[current.status] || '';
    } };
}
