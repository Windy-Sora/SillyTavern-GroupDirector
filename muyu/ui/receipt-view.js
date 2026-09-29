import { receiptText } from '../actions/receipts.js';

/** Plain application facts, distinct from user/assistant messages. */
export function createReceiptView({ doc, parent, controller, act, lang }) {
    const root = doc.createElement('section'); parent.append(root);
    const t = (zh, en) => lang === 'en' ? en : zh;
    const labels = { queued: ['等待解释', 'Explanation queued'], running: ['正在解释', 'Explaining'], cancelling: ['正在停止解释', 'Stopping explanation'], succeeded: ['解释完成', 'Explanation complete'], failed: ['解释失败，可重试', 'Explanation failed; retry available'], cancelled: ['解释已取消', 'Explanation cancelled'], interrupted: ['解释已中断', 'Explanation interrupted'], yielded: ['解释已暂停', 'Explanation paused'] };
    let signature = '';
    return { render(state) {
        const next = JSON.stringify([state.receipts, state.receiptRecordFailed, state.receiptExplanations, state.configChecks, state.busy, state.resetting, state.readOnly, state.enabled, state.context?.omitHistory, state.permissions?.diagnostics, state.canReadConfig, state.canCheckReceipts]);
        if (next === signature) return; signature = next; root.replaceChildren();
        const node = (tag, text, parent = root) => { const e = doc.createElement(tag); e.textContent = text; parent.append(e); return e; };
        root.hidden = !state.receipts?.length;
        if (root.hidden) return;
        node('h4', t('操作回执 · 历史结果', 'Operation receipts · Historical results'));
        if (state.receiptRecordFailed) node('p', t('部分回执未能加入历史；操作不会重试。请复制保留当前结果。', 'Some receipts could not be recorded; operations will not retry. Copy these results for safekeeping.'));
        for (const r of state.receipts) {
            const card = node('div', ''); card.className = 'gd-muyu-artifact';
            node('p', receiptText(r, lang), card).setAttribute('style', 'white-space: pre-wrap');
            const status = state.receiptExplanations?.[r.operationId];
            const actions = node('div', '', card); actions.className = 'gd-muyu-receipt-actions';
            if (status) node('small', t(...(labels[status] || ['解释状态未知', 'Explanation status unknown'])) + t('；不改变操作结果', '; does not change the operation result'), actions).setAttribute('role', 'status');
            const check = state.configChecks?.[r.operationId];
            if (check) {
                const checks = { reading: ['正在核对', 'Checking'], matched: ['读取时与提议值一致', 'Matched proposed values at read time'], different: ['读取时与提议值不一致', 'Different from proposed values at read time'], unknown: ['无法核对', 'Unable to verify'], permission_required: ['尚未核对：需要配置读取授权', 'Not checked: settings read permission required'] };
                node('p', t(...(checks[check.state] || checks.unknown)) + (check.readAt ? ' · ' + check.readAt : ''), actions).setAttribute('role', 'status');
                for (const field of check.fields) node('small', `${field.field}: ${field.actual || t('未知', 'unknown')} · ${t('提议', 'proposed')} ${field.expected}`, actions);
                node('small', t('仅是读取时的内存值，不证明持久化，也不改变原回执。', 'In-memory values at read time only; not proof of persistence. Original receipt unchanged.'), actions);
            }
            if (state.readOnly) continue;
            if (r.version !== 3 && r.version !== 4 && r.version !== 5) {
                const b = node('button', t('让暮羽解释结果', 'Ask Muyu to explain'), actions); b.type = 'button'; b.className = 'menu_button';
                b.disabled = state.busy || state.resetting || !state.enabled || state.context?.omitHistory || !(state.canReadConfig ?? state.permissions?.diagnostics);
                b.onclick = () => act(() => controller.explainReceipt(r.operationId));
                const verify = node('button', t('核对当前配置', 'Check current settings'), actions); verify.type = 'button'; verify.className = 'menu_button';
                verify.disabled = state.busy || state.resetting || !state.enabled || !(state.canCheckReceipts?.[r.operationId] ?? state.canReadConfig ?? state.permissions?.diagnostics);
                verify.onclick = () => act(() => controller.checkReceipt(r.operationId));
            }
        }
        node('small', t('解释快捷入口需要相应资料授权；也可直接问暮羽按需申请。解释使用模型预算；配置核对只在本地读取，不重新应用。', 'Explanation shortcuts need the relevant read grant; Muyu can request it on demand. Explanation uses model budget; configuration checks read locally without reapplying.'));
    } };
}
