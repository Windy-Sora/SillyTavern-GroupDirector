import { permissionTitle, permissionSource } from '../permissions/contract.js';

/** UI can answer an existing request, never supply its target or permission scope. */
export function createPermissionView({ doc, parent, settings, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, owner) => { const e = doc.createElement(tag); e.textContent = text; owner.append(e); return e; };
    const root = node('section', '', parent); root.className = 'gd-muyu-interaction'; root.hidden = true;
    const title = node('strong', '', root), reason = node('p', '', root), scope = node('p', '', root);
    const actions = node('div', '', root); actions.className = 'gd-muyu-actions';
    let current = null;
    const buttons = [['task', t('允许本任务', 'Allow this task')], ['chat', t('允许此聊天', 'Allow this chat')], ['deny', t('拒绝并继续', 'Deny and continue')]].map(([decision, text]) => {
        const b = node('button', text, actions); b.type = 'button'; b.className = 'menu_button';
        b.onclick = () => act(() => controller.answerPermission(current.id, decision)); return b;
    });
    const cancel = node('button', t('取消任务', 'Cancel task'), actions); cancel.type = 'button'; cancel.className = 'menu_button'; cancel.onclick = () => act(() => controller.cancelInteraction(current.id));
    node('small', t('本任务授权在任务结束后失效；持续授权仅在当前连接及指定范围内复用，可在配置中撤销。读取授权不批准修改。', 'Task access expires at task end. Ongoing access lasts for this connection and stated scope; revoke it in settings. Read access does not approve changes.'), root);
    const status = node('p', '', parent); status.setAttribute('role', 'status'); status.hidden = true;
    const grants = node('div', '', settings);
    let signature = '';
    return { render(s) {
        current = s.interaction?.kind === 'permission' ? s.interaction : null;
        const pending = current?.status === 'pending'; root.hidden = !pending;
        for (const b of buttons) b.disabled = !pending || s.busy || s.resetting;
        buttons[1].hidden = current?.source === 'providerExecution';
        cancel.disabled = !pending || s.resetting;
        if (pending) {
            const global = permissionSource(current.source)?.scope === 'global';
            buttons[1].textContent = global ? t('允许本连接', 'Allow this connection') : t('允许此聊天', 'Allow this chat');
            title.textContent = current.source === 'providerExecution' ? t('暮羽请求执行代码：', 'Muyu requests code execution: ') + `${current.providerId} (${current.providerRevision})` : t('暮羽希望读取：', 'Muyu requests access to: ') + permissionTitle(current.source);
            reason.textContent = t('模型说明的用途：', 'Model-provided reason: ') + current.reason;
            scope.textContent = (current.source === 'providerExecution' ? t('只允许本任务执行此版本 Provider。代码在酒馆页面运行，可能修改数据、联网或产生费用；超时不能保证中止。', 'Only this task may run this Provider version. Code runs in the ST page and may change data, use the network or incur costs; timeout cannot reliably stop it. ') : global ? t('范围：此来源的全局白名单配置，不含聊天正文。', 'Scope: global whitelist settings for this source, no chat bodies. ') : t('范围：当前酒馆聊天的指定资料来源。', 'Scope: this source in the current ST chat. ')) + t('结果会发送至：', 'Output goes to: ') + (s.connection ? `${s.connection.model} · ${s.connection.endpoint}` : '');
        }
        status.hidden = !current || !['expired', 'cancelled'].includes(current.status);
        status.textContent = current?.status === 'expired' ? t('读取授权申请已失效。', 'Read permission request expired.') : t('读取授权申请已取消。', 'Read permission request cancelled.');
        const next = JSON.stringify([s.sourceGrants || [], s.busy, s.resetting]);
        if (next !== signature) {
            signature = next; grants.replaceChildren();
            node('strong', t('当前有效的资料授权', 'Active data grants'), grants);
            if (!s.sourceGrants?.length) node('small', t('暂无；暮羽需要资料时会申请。', 'None. Muyu will ask when data is needed.'), grants);
            for (const key of s.sourceGrants || []) {
                const row = node('div', permissionTitle(key.slice(7)), grants);
                const b = node('button', t('撤销', 'Revoke'), row); b.type = 'button'; b.className = 'menu_button'; b.disabled = s.resetting;
                b.onclick = () => act(() => controller.revokePermission(key));
            }
        }
    } };
}
