import { memoryFields } from '../modules/config-draft/contracts.js';

/** Text-only DOM view. The controller owns all state and execution. Returns an idempotent teardown. */
export function mountMuyuPanel(root, controller, { lang = 'zh', navigateMemory = () => {} } = {}) {
    root.__gdMuyuDispose?.(); const doc = root.ownerDocument, en = lang === 'en';
    const t = (zh, english) => en ? english : zh;
    const node = (tag, text, parent = root) => { const e = doc.createElement(tag); if (text) e.textContent = text; parent.append(e); return e; };
    const button = (label, parent) => { const e = node('button', label, parent); e.type = 'button'; e.className = 'menu_button'; return e; };
    const field = (label, type, parent) => { const wrapper = node('label', label, parent), input = node('input', '', wrapper); input.type = type; if (type !== 'checkbox') input.className = 'text_pole'; return input; };
    root.classList.add('gd-muyu-entry');
    const shell = node('details', ''), title = node('summary', t('暮羽助手 · 实验版', 'Muyu assistant · Experimental'), shell);
    title.setAttribute('aria-label', title.textContent);
    const body = node('div', '', shell); body.className = 'gd-muyu-panel';
    node('p', t('仅排查与草稿，不会应用配置。会话、产物和密钥仅保留到页面刷新。', 'Diagnostics and drafts only; no configuration application. Sessions, artifacts and credentials are lost on refresh.'), body);
    const connection = node('details', '', body); node('summary', t('连接与隐私', 'Connection and privacy'), connection);
    connection.open = !controller.snapshot().enabled;
    node('p', t('输入及已授权状态会发送至下方服务。更换连接会取消任务并清空会话和产物。密钥不持久保存。', 'Input and authorized state go to this service. Reconnecting cancels tasks and clears sessions/artifacts. Credentials are not persisted.'), connection);
    const endpoint = field(t('完整接口地址', 'Full endpoint'), 'url', connection); endpoint.value = 'https://api.deepseek.com/chat/completions';
    const model = field(t('模型', 'Model'), 'text', connection); model.value = 'deepseek-flash';
    const key = field(t('API 密钥（仅内存）', 'API key (memory only)'), 'password', connection); key.autocomplete = 'off';
    const thinking = field(t('开启 DeepSeek 思考', 'Enable DeepSeek thinking'), 'checkbox', connection); thinking.checked = true;
    const connect = button(t('启用此连接', 'Enable connection'), connection), disable = button(t('禁用并清除', 'Disable and clear'), connection);
    const status = node('p', '', body); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const activeConnection = node('small', '', body);
    const modes = node('div', '', body); modes.className = 'gd-muyu-actions';
    const memoryMode = button(t('排查记忆', 'Diagnose memory'), modes), draftMode = button(t('配置草稿', 'Configuration draft'), modes);
    const consent = field(t('本次允许发送白名单设置和匿名记忆统计（不含正文或身份）', 'Allow whitelist settings and anonymous memory counts for this request (no bodies or identities)'), 'checkbox', body);
    const scope = node('fieldset', '', body); node('legend', t('本次允许草稿修改的字段（影响所有聊天）', 'Fields this draft may change (all chats)'), scope);
    const labels = [t('记忆总开关', 'Memory enabled'), t('自动提取开关', 'Automatic extraction'), t('新增消息间隔', 'New-message interval'), t('仅发言角色', 'Speakers only')];
    const fields = memoryFields.map((name, i) => [name, field(labels[i], 'checkbox', scope)]);
    const history = node('div', '', body); history.className = 'gd-muyu-history'; history.setAttribute('aria-label', t('对话记录', 'Conversation'));
    const cards = node('div', '', body);
    const followLabel = node('label', t('修改已有草稿，或开始新任务', 'Revise a draft, or start a new task'), body), follow = node('select', '', followLabel); follow.className = 'text_pole';
    const inputLabel = node('label', t('给暮羽的消息', 'Message to Muyu'), body), input = node('textarea', '', inputLabel); input.className = 'text_pole'; input.rows = 3; input.maxLength = 16000;
    const actions = node('div', '', body); actions.className = 'gd-muyu-actions';
    const send = button(t('发送', 'Send'), actions), stop = button(t('停止', 'Stop'), actions);
    const errors = node('p', '', body); errors.setAttribute('role', 'alert');
    let unsubscribe, disposed = false, lastView = '', lastConnection = null;
    const notices = {
        MODEL_NETWORK_ERROR: t('网络请求失败，可能涉及 CORS；不代表密钥错误。', 'Network request failed; CORS is possible. This does not establish an invalid key.'),
        MODEL_AUTH_ERROR: t('服务拒绝认证或访问，请检查密钥与权限。', 'Service rejected authentication/access. Check credentials and permissions.'),
        MODEL_RATE_LIMIT: t('服务限流，请稍后手动重试。', 'Service rate limit; retry manually later.'),
        MODEL_SERVICE_ERROR: t('模型服务暂时失败。', 'Model service failed.'),
        MODEL_HISTORY_UNAVAILABLE: t('服务缺少工具思考回传所需信息，未静默关闭思考。', 'Required thinking/tool history is unavailable; thinking was not silently disabled.'),
        TIMEOUT: t('任务超时，正在等待上游清理。', 'Task timed out; awaiting upstream cleanup.'),
        BUDGET_EXCEEDED: t('已达到任务预算，未继续调用。', 'Run budget reached; no further calls.'),
        NO_CANDIDATE: t('模型未提交有效配置候选，未生成可用草稿。', 'No valid configuration candidate was submitted.'),
        RESULT_NEEDS_REVIEW: t('未能发布可信产物，证据可能缺失或已变化，请重新排查或生成。', 'Could not publish a verified artifact; evidence may be missing or changed. Run again.'),
    };
    function showError(error) {
        const code = error?.message;
        const known = { CONSENT_REQUIRED: t('请确认本次数据外发范围。', 'Confirm data sharing for this request.'), FIELD_SCOPE_REQUIRED: t('请选择本次可修改的字段。', 'Choose fields for this draft.'), CHAT_REQUIRED: t('请先打开聊天。', 'Open a chat first.'), EMPTY_INPUT: t('请输入问题。', 'Enter a question.'), NOT_READY: t('请先启用连接，或等待任务清理结束。', 'Enable a connection or wait for cleanup.'), STALE_DRAFT: t('草稿或配置已变化，请重新生成预览。', 'Draft/settings changed; generate a fresh preview.') };
        errors.textContent = known[code] || t('操作未完成，请检查连接配置、状态和输入。网络失败也可能是 CORS，禁止据此断言密钥错误。', 'Operation failed. Check connection, state and input. Network failure may be CORS, not necessarily invalid credentials.');
    }
    async function act(fn) { errors.textContent = ''; try { await fn(); } catch (e) { showError(e); } if (!disposed && shell.open) render(); }
    function render() {
        if (disposed) return; const s = controller.snapshot();
        const view = s.viewToken;
        if (view !== lastView) { consent.checked = false; fields.forEach(([, f]) => { f.checked = false; }); lastView = view; }
        if (s.connection && JSON.stringify(s.connection) !== lastConnection) { endpoint.value = s.connection.endpoint; model.value = s.connection.model; thinking.checked = s.connection.thinking; lastConnection = JSON.stringify(s.connection); }
        activeConnection.textContent = s.connection ? t('当前请求目标：', 'Active request destination: ') + s.connection.model + ' · ' + s.connection.endpoint : '';
        status.textContent = [s.enabled ? t('已启用', 'Enabled') : t('未启用', 'Disabled'), s.mode === 'memory' ? t('范围：当前聊天', 'Scope: current chat') : t('范围：全局设置', 'Scope: global settings'), s.resetting || s.draining ? t('等待上游清理…', 'Waiting for cleanup…') : s.busy ? t('运行中…', 'Running…') : t('空闲', 'Idle'), notices[s.notice] || ''].filter(Boolean).join(' · ');
        scope.hidden = s.mode !== 'draft'; followLabel.hidden = s.mode !== 'draft';
        memoryMode.setAttribute('aria-pressed', String(s.mode === 'memory')); draftMode.setAttribute('aria-pressed', String(s.mode === 'draft'));
        send.disabled = !s.enabled || s.busy || s.resetting || s.mode === 'memory' && !s.hasChat; stop.disabled = !s.busy || s.resetting;
        connect.disabled = disable.disabled = s.resetting; if (input.value !== s.input) input.value = s.input;
        history.replaceChildren(); for (const message of s.messages) { const p = node('p', '', history); node('strong', message.role === 'user' ? t('你：', 'You: ') : t('暮羽：', 'Muyu: '), p); node('span', message.content, p); }
        const last = s.runs.at(-1); if (last) node('p', t('最近任务：', 'Latest task: ') + last.status + (last.error ? ' · ' + last.error : ''), history);
        cards.replaceChildren(); const selected = follow.value; follow.replaceChildren(); const none = node('option', t('新任务', 'New task'), follow); none.value = '';
        for (const artifact of s.artifacts) {
            const card = node('section', '', cards); card.className = 'gd-muyu-card';
            node('strong', (artifact.kind === 'report' ? t('排查报告', 'Diagnostic report') : t('配置草稿', 'Configuration draft')) + ' · v' + artifact.revision, card);
            if (artifact.kind === 'report') {
                for (const f of artifact.content.findings) node('p', `${f.kind} · ${f.code}: ${f.text}`, card);
                node('small', t('这是生成时的证据快照，不是实时状态。', 'Snapshot at generation time, not live state.'), card);
                button(t('前往记忆设置', 'Open memory settings'), card).onclick = navigateMemory;
            } else {
                for (const d of artifact.content.preview.diff) node('p', `${d.field}: ${d.before} → ${d.after}`, card);
                node('p', artifact.content.preview.notice, card); node('p', artifact.content.preview.warnings.join(' · '), card);
                node('p', artifact.validation?.status === 'stale' ? t('过期，需重新生成', 'Stale; regenerate') : artifact.validation ? t('已校验当时基线；使用前需复核，未应用', 'Validated against saved baseline; recheck before use. Not applied.') : t('未校验，未应用', 'Not validated; not applied'), card);
                const recheck = button(t('重新校验', 'Revalidate'), card); recheck.disabled = s.busy || s.resetting; recheck.onclick = () => act(() => controller.revalidate(artifact.id, artifact.revision));
                const option = node('option', `${artifact.id} · v${artifact.revision}`, follow); option.value = artifact.id;
            }
        }
        if ([...follow.options].some(o => o.value === selected)) follow.value = selected;
    }
    const subscribe = () => { if (!unsubscribe) unsubscribe = controller.subscribe(render).unsubscribe; render(); };
    shell.addEventListener('toggle', () => { if (disposed) return; if (shell.open) subscribe(); else { unsubscribe?.(); unsubscribe = null; key.value = ''; } });
    memoryMode.onclick = () => act(() => controller.setMode('memory')); draftMode.onclick = () => act(() => controller.setMode('draft'));
    input.oninput = () => { try { controller.setInput(input.value); } catch (e) { showError(e); } };
    send.onclick = () => act(() => { controller.setInput(input.value); controller.send({ consent: consent.checked, fields: fields.filter(([, f]) => f.checked).map(([name]) => name), artifactId: follow.value || null }); consent.checked = false; });
    stop.onclick = () => act(() => controller.stop());
    connect.onclick = () => act(async () => { const apiKey = key.value; key.value = ''; await controller.configure({ endpoint: endpoint.value.trim(), apiKey, model: model.value.trim(), profile: 'deepseek', thinking: thinking.checked, supportsTools: true }); consent.checked = false; fields.forEach(([, f]) => { f.checked = false; }); });
    disable.onclick = () => act(() => controller.disable());
    input.onkeydown = event => { if (event.ctrlKey && event.key === 'Enter' && !send.disabled) { event.preventDefault(); send.click(); } };
    render();
    const dispose = () => { if (disposed) return; disposed = true; unsubscribe?.(); key.value = ''; shell.remove(); if (root.__gdMuyuDispose === dispose) delete root.__gdMuyuDispose; };
    root.__gdMuyuDispose = dispose; return dispose;
}
