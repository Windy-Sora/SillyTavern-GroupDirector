import { memoryFields } from '../modules/config-draft/contracts.js';
import { createProcessView, processLabel } from './process-view.js';
import { taskCatalog } from '../modules/catalog.js';
import { renderMarkdown } from './markdown.js';
import { RUN_DEFAULTS, RUN_RANGES } from '../core/budget.js';
import { formatBudget, budgetReasonLabel } from './budget-view.js';
import { createHistoryView } from './history-view.js';
import { createContextView } from './context-view.js';
import { createInstructionView } from './instruction-view.js';
import { createSettingsLayout } from './settings-layout.js';
import { createInteractionView } from './interaction-view.js';
import { createPermissionView } from './permission-view.js';
import { renderConfigApply } from './config-apply-view.js';
import { renderVariableApply } from './variable-apply-view.js';
import { renderTaskBundleApply } from './task-bundle-apply-view.js';
import { renderProfileSave } from './profile-save-view.js';
import { permissionTitle } from '../permissions/contract.js';
import { createReceiptView } from './receipt-view.js';

/** Safe Markdown view. The controller owns all state and execution. */
export function mountMuyuPanel(root, controller, { lang = 'zh', navigateMemory = () => {}, navigateDirector = () => {}, standalone = false, actionsRoot = null, resetLayout = () => {}, setSidebarOpen } = {}) {
    root.__gdMuyuDispose?.(); const doc = root.ownerDocument, en = lang === 'en';
    const t = (zh, english) => en ? english : zh;
    const unified = controller.snapshot().mode === 'assistant';
    const legacyRoot = doc.createElement('div'); // Detached compatibility controls for legacy embedders only.
    const node = (tag, text, parent = root) => { const e = doc.createElement(tag); if (text) e.textContent = text; parent.append(e); return e; };
    const button = (label, parent) => { const e = node('button', label, parent); e.type = 'button'; e.className = 'menu_button'; return e; };
    const field = (label, type, parent) => { const wrapper = node('label', label, parent), input = node('input', '', wrapper); input.type = type; if (type !== 'checkbox') input.className = 'text_pole'; return input; };
    root.classList.add('gd-muyu-entry');
    const shell = node(standalone ? 'div' : 'details', ''), title = node(standalone ? 'h3' : 'summary', t('暮羽助手 · 实验版', 'Muyu assistant · Experimental'), shell);
    title.setAttribute('aria-label', title.textContent);
    shell.className = standalone ? 'gd-muyu-chat-shell' : '';
    if (standalone) { root.classList.add('gd-muyu-floating'); title.hidden = true; }
    const body = node('div', '', shell); body.className = 'gd-muyu-panel';
    const gear = button('⚙', actionsRoot || body); gear.setAttribute('aria-label', t('暮羽配置', 'Muyu settings')); gear.title = t('暮羽配置', 'Muyu settings');
    const connection = node('section', '', body); connection.className = 'gd-muyu-settings'; connection.hidden = true;
    const back = button(t('返回聊天', 'Back to chat'), connection);
    const settingsLayout = createSettingsLayout({ doc, root: connection, lang });
    node('h3', t('连接与隐私', 'Connection and privacy'), settingsLayout.pages.connection);
    node('p', t('默认模式下，模型只读并生成草稿，配置由你逐份确认应用。全权限模式开启后，可直接执行已登记修改与 Provider；记忆上限可能裁剪当前聊天旧记忆。授权不跨连接或刷新保留。', 'Normally the model reads and drafts; you approve each change. Full-access mode can directly execute registered changes and Providers. The memory limit may prune this chat. Full access does not survive reconnection or reload.'), settingsLayout.pages.connection);
    node('p', t('输入及已授权资料会发送至下方服务。更换连接会取消任务并清除运行产物和授权，历史记录仍可查看。', 'Input and authorized data go to this service. Reconnecting cancels tasks and clears live artifacts/grants; history remains available.'), settingsLayout.pages.connection);
    const endpoint = field(t('完整接口地址', 'Full endpoint'), 'url', settingsLayout.pages.connection); endpoint.value = 'https://api.deepseek.com/chat/completions';
    const model = field(t('模型', 'Model'), 'text', settingsLayout.pages.connection); model.value = 'deepseek-flash';
    const key = field(t('API 密钥', 'API key'), 'password', settingsLayout.pages.connection); key.autocomplete = 'off';
    const initialConnection = controller.snapshot().connection;
    const savedConnection = controller.snapshot().savedConnection;
    const rememberKey = field(t('记住 API Key', 'Remember API key'), 'checkbox', settingsLayout.pages.connection);
    rememberKey.checked = initialConnection ? initialConnection.remembered !== false : true;
    const autoConnect = field(t('下次打开时自动启用此连接（默认开启）', 'Enable this connection automatically next time (on by default)'), 'checkbox', settingsLayout.pages.connection);
    autoConnect.checked = initialConnection ? initialConnection.autoConnect === true : savedConnection ? savedConnection.autoConnect === true : true;
    rememberKey.onchange = () => { if (!rememberKey.checked) autoConnect.checked = false; };
    autoConnect.onchange = () => { if (autoConnect.checked) rememberKey.checked = true; };
    node('small', t('自动启用需要记住 API Key。密钥保存在酒馆插件设置中，未加密，同源脚本及酒馆备份可能读取；仅复用到相同接口地址。自动启用不会恢复资料授权，也不会主动发送消息。', 'Automatic enablement requires remembering the API key. It is stored unencrypted in ST extension settings; same-origin scripts and backups may access it. Reused only at the same endpoint. Auto-enable does not restore data grants or send messages.'), settingsLayout.pages.connection);
    const savedKeyStatus = node('small', '', settingsLayout.pages.connection), forgetKey = button(t('清除已保存密钥', 'Forget saved key'), settingsLayout.pages.connection);
    const thinking = field(t('开启 DeepSeek 思考', 'Enable DeepSeek thinking'), 'checkbox', settingsLayout.pages.connection); thinking.checked = true;
    const connect = button(t('启用此连接', 'Enable connection'), settingsLayout.pages.connection), disable = button(t('禁用连接', 'Disable connection'), settingsLayout.pages.connection);
    node('small', t('禁用停止任务，但不删除历史；密钥请使用“清除已保存密钥”。', 'Disabling stops tasks, not history storage. Use Forget saved key to erase the saved credential.'), settingsLayout.pages.connection);
    node('h3', t('上下文与权限', 'Context and permissions'), settingsLayout.pages.data);
    node('p', t('授权在本连接内复用，并按聊天隔离。撤销会停止任务、清除运行产物并打开空白会话；旧历史仅保留查看，重新外发须核验授权。不能撤回已发送的数据。', 'Grants are reused per connection and isolated per chat. Revoking stops tasks, clears live artifacts and opens a blank conversation. Old history remains viewable; resending requires authorization. Sent data cannot be recalled.'), settingsLayout.pages.data);
    const diagnosticPermission = field(t('插件诊断信息（白名单配置、匿名统计与运行状态）', 'Plugin diagnostics (whitelist settings, anonymous counts and state)'), 'checkbox', unified ? legacyRoot : settingsLayout.pages.data);
    const chatPermission = field(t('当前聊天资料（消息、总结、档案、记忆正文及名称）', 'Current chat data (messages, summary, profiles, memories and names)'), 'checkbox', unified ? legacyRoot : settingsLayout.pages.data);
    const extendedPermission = field(t('扩展剧情上下文（当前已加载历史分段读取、参聊角色卡、导演历史账本正文）', 'Extended story context (loaded chat history in ranges, participant cards, director ledger bodies)'), 'checkbox', unified ? legacyRoot : settingsLayout.pages.data);
    const fullAccessToggle = field(t('全权限模式（危险，默认关闭）', 'Full-access mode (dangerous, off by default)'), 'checkbox', settingsLayout.pages.data);
    node('small', t('开启后，本连接内的资料读取、已注册 Provider 代码执行及暮羽明确提出的配置／整单写入无需逐次确认。代码可能联网、修改数据或产生费用；保存可能部分完成且无法可靠撤销。仍受工具白名单、当前聊天范围和预算限制。更换连接或刷新即关闭。', 'While enabled, reads, registered Provider code execution, and Muyu-requested settings/bundle writes need no per-action approval. Code may access the network, change data or incur costs; saves may partially complete and cannot reliably be undone. Tool allowlists, chat scope and budgets still apply. Reconnection or reload turns it off.'), settingsLayout.pages.data);
    const budgetSettings = node('details', '', settingsLayout.pages.limits); node('summary', t('运行与预算', 'Execution budgets'), budgetSettings);
    node('p', t('保存后从下一轮生效，不改变正在执行的任务。模型调用上限包含最后一次无工具收尾。增加预算可能增加费用；超时最高120秒。', 'Saved settings apply to the next run only. Model-call limit includes final answer-only closure. Higher budgets may cost more; deadline is capped at 120 seconds.'), budgetSettings);
    const budgetFields = Object.entries({ modelCalls: t('模型调用次数', 'Model calls'), toolCalls: t('工具调用次数', 'Tool calls'), timeMs: t('单轮超时（秒）', 'Run timeout (seconds)'), maxTokens: t('单次模型输出上限（Token）', 'Output tokens per model call'), providerBytes: t('资料读取预算（UTF-8字节）', 'Provider data budget (UTF-8 bytes)') }).map(([name, label]) => {
        const input = field(label, 'number', budgetSettings), scale = name === 'timeMs' ? 1000 : 1;
        input.min = RUN_RANGES[name][0] / scale; input.max = RUN_RANGES[name][1] / scale; input.step = 1;
        node('small', `${input.min}–${input.max}`, input.parentElement || input.parent);
        return { name, input, scale };
    });
    const saveBudget = button(t('保存运行预算', 'Save execution budgets'), budgetSettings), resetBudget = button(t('恢复默认预算并保存', 'Restore and save defaults'), budgetSettings);
    node('small', unified ? t('暮羽需要资料时会说明来源、用途与发送目的地，请按需批准。读取授权不批准修改；不会读取其他聊天或整个角色库。', 'Muyu requests sources when needed and shows the purpose and destination. Read access does not approve changes or access other chats or the whole character library.') : t('扩展权限独立开启并在当前聊天内复用，不读取其他聊天或整个角色库。角色卡内的提示词和导演原因仅作资料，不代表实际执行。', 'Extended access is opt-in and reused only in this chat, not other chats or the whole character library. Card prompts and director reasons are data, not proof of execution.'), settingsLayout.pages.data);
    budgetSettings.open = true;
    if (standalone) button(t('重置窗口大小', 'Reset window size'), settingsLayout.pages.connection).onclick = resetLayout;
    const workspace = node('div', '', body); workspace.className = 'gd-muyu-workspace';
    const sidebarRoot = node('div', '', workspace); sidebarRoot.className = 'gd-muyu-sidebar-slot';
    const chat = node('div', '', workspace); chat.className = 'gd-muyu-chat';
    const historyView = createHistoryView({ doc, settings: settingsLayout.pages.data, chat, workspace, sidebarRoot, controller, act, lang, setSidebarOpen });
    const setupBar = node('div', '', chat); setupBar.className = 'gd-muyu-connection-entry';
    const setup = button(t('配置连接', 'Configure connection'), setupBar);
    const tools = node('details', '', chat); tools.className = 'gd-muyu-conversation-tools';
    node('summary', t('会话工具 · 上下文与开销', 'Conversation tools · Context & usage'), tools);
    const toolContent = node('div', '', tools); toolContent.className = 'gd-muyu-conversation-tools-content';
    const transcript = node('div', '', chat); transcript.className = 'gd-muyu-transcript';
    const welcome = node('div', '', transcript); welcome.className = 'gd-muyu-welcome';
    node('h3', t('今天想一起解决什么？', 'What shall we work on today?'), welcome);
    node('p', t('你好，我是暮羽。可以查阅已授权的聊天资料、排查记忆和导演状态，或整理配置草稿。', 'Hi, I’m Muyu. I can consult authorized chat data, diagnose memory/director state, or prepare configuration drafts.'), welcome);
    const history = node('div', '', transcript); history.className = 'gd-muyu-history'; history.setAttribute('aria-label', t('对话记录', 'Conversation'));
    const cards = node('div', '', transcript);
    const receiptView = createReceiptView({ doc, parent: transcript, controller, act, lang });
    const interactionView = createInteractionView({ doc, parent: transcript, controller, act, lang });
    const permissionView = createPermissionView({ doc, parent: transcript, settings: settingsLayout.pages.data, controller, act, lang });
    const fullAccessBanner = node('small', t('⚠ 全权限模式已开启：暮羽可读取资料、执行 Provider 并直接应用其请求的修改；请留意任务和操作回执。', '⚠ Full-access mode: Muyu may read data, execute Providers and apply requested changes without further confirmation. Watch task progress and receipts.'), chat);
    fullAccessBanner.className = 'gd-muyu-full-access-warning'; fullAccessBanner.hidden = true;
    const composer = node('div', '', chat); composer.className = 'gd-muyu-composer';
    const status = node('p', '', composer); status.className = 'gd-muyu-chat-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const permissionSummary = button('', toolContent); permissionSummary.className += ' gd-muyu-permission-summary';
    const usageDetails = node('details', '', toolContent); node('summary', t('本轮开销与限制', 'Run usage and limits'), usageDetails); const usageText = node('p', '', usageDetails);
    const contextView = createContextView({ doc, settings: settingsLayout.pages.limits, parent: toolContent, controller, act, lang });
    const instructionView = createInstructionView({ doc, settings: settingsLayout.pages.behavior, controller, act, lang });
    const inputBox = node('div', '', composer); inputBox.className = 'gd-muyu-input-box';
    const inputLabel = node('label', t('给暮羽的消息', 'Message to Muyu'), inputBox), input = node('textarea', '', inputLabel); input.className = 'text_pole'; input.rows = 3; input.maxLength = 16000;
    const recoveryBar = node('div', '', inputBox); recoveryBar.className = 'gd-muyu-recovery'; recoveryBar.hidden = true;
    const recoveryNote = node('small', '', recoveryBar), restoreInput = button(t('恢复失败问题到输入框', 'Restore failed question to composer'), recoveryBar);
    let recoveryRunId = null;
    restoreInput.onclick = () => act(() => { controller.restoreFailedInput(recoveryRunId); input.focus?.(); });
    inputLabel.className = 'gd-muyu-input-label'; input.setAttribute('aria-label', t('给暮羽的消息', 'Message to Muyu'));
    input.placeholder = t('向暮羽提问，或描述你想排查的问题…', 'Ask Muyu a question, or describe what needs investigating…');
    const inputToolbar = node('div', '', inputBox); inputToolbar.className = 'gd-muyu-input-toolbar';
    const modeLabel = node('label', t('任务', 'Task'), unified ? legacyRoot : inputToolbar), mode = node('select', '', modeLabel); mode.className = 'text_pole'; modeLabel.className = 'gd-muyu-mode';
    for (const [value, task] of Object.entries(taskCatalog)) { const option = node('option', t(...task.label), mode); option.value = value; }
    const authorization = node('section', '', unified ? legacyRoot : composer); authorization.className = 'gd-muyu-authorization'; authorization.hidden = true;
    node('strong', t('授权与发送', 'Authorize and send'), authorization);
    const activeConnection = node('small', '', authorization);
    node('p', t('你的输入及本会话历史会发给该服务。草稿不会自动应用。', 'Your input and this conversation history go to this service. Drafts are never applied automatically.'), authorization);
    const consent = field(t('本次允许发送白名单设置和匿名记忆统计（不含正文或身份）', 'Allow whitelist settings and anonymous memory counts for this request (no bodies or identities)'), 'checkbox', authorization);
    const consentLabel = consent.parentElement || consent.parent;
    const consentText = doc.createElement('span');
    // Keep the checkbox node stable while switching task-specific permission wording.
    consentLabel.textContent = ''; consentLabel.replaceChildren(); consentLabel.className = 'gd-muyu-consent'; consentLabel.append(consentText); consentLabel.append(consent);
    const scope = node('fieldset', '', authorization); node('legend', t('本次允许草稿修改的字段（影响所有聊天）', 'Fields this draft may change (all chats)'), scope);
    const labels = [t('记忆总开关', 'Memory enabled'), t('自动提取开关', 'Automatic extraction'), t('新增消息间隔', 'New-message interval'), t('仅发言角色', 'Speakers only')];
    const fields = memoryFields.map((name, i) => [name, field(labels[i], 'checkbox', scope)]);
    const confirm = button(t('确认发送', 'Confirm and send'), authorization), cancelAuth = button(t('返回编辑', 'Keep editing'), authorization);
    const withoutData = button(t('仅发送问题，不读取聊天资料', 'Send without chat data'), authorization);
    const followLabel = node('label', t('修改已有草稿，或开始新任务', 'Revise a draft, or start a new task'), unified ? legacyRoot : composer), follow = node('select', '', followLabel); follow.className = 'text_pole';
    const actions = node('div', '', inputToolbar); actions.className = 'gd-muyu-actions';
    const send = button(t('发送', 'Send'), actions), stop = button(t('停止', 'Stop'), actions);
    send.className += ' gd-muyu-send'; stop.className += ' gd-muyu-stop';
    const inputHint = node('small', t('Ctrl+Enter 发送 · Enter 换行', 'Ctrl+Enter to send · Enter for a new line'), composer); inputHint.className = 'gd-muyu-input-hint';
    const errors = node('p', '', body); errors.setAttribute('role', 'alert');
    let unsubscribe, disposed = false, lastView = '', lastConnection = null, lastRunConfig = '';
    const processView = createProcessView({ doc, lang }), processAnchors = new Map();
    let historySignature = '', scrollKey = null;
    transcript.onscroll = () => { if (scrollKey) controller.setScrollPosition?.(scrollKey, transcript.scrollTop); };
    function resetAuthorization() { authorization.hidden = true; consent.checked = false; fields.forEach(([, f]) => { f.checked = false; }); }
    function showSettings(show, category) {
        if (show && category) settingsLayout.select(category);
        connection.hidden = !show; workspace.hidden = chat.hidden = show; gear.setAttribute('aria-expanded', String(show)); errors.textContent = '';
        historyView.setVisible(!show);
        resetAuthorization(); if (!show) key.value = '';
        (show ? back : input).focus?.();
    }
    gear.onclick = () => showSettings(connection.hidden); back.onclick = () => showSettings(false); setup.onclick = () => showSettings(true, 'connection');
    permissionSummary.onclick = () => showSettings(true, 'data');
    gear.setAttribute('aria-expanded', 'false');
    const notices = {
        CONTEXT_LIMIT: t('输入超过手动预算或请求体安全上限；未发送超限请求。可整理历史、缩短输入或调整预算。', 'Input exceeds the manual budget or request-size safety limit; the oversized request was not sent. Summarize history, shorten input or adjust the budget.'),
        MODEL_NETWORK_ERROR: t('网络请求失败，可能涉及 CORS；不代表密钥错误。', 'Network request failed; CORS is possible. This does not establish an invalid key.'),
        MODEL_AUTH_ERROR: t('服务拒绝认证或访问，请检查密钥与权限。', 'Service rejected authentication/access. Check credentials and permissions.'),
        MODEL_RATE_LIMIT: t('服务限流，请稍后手动重试。', 'Service rate limit; retry manually later.'),
        MODEL_SERVICE_ERROR: t('模型服务暂时失败。', 'Model service failed.'),
        MODEL_OUTPUT_TRUNCATED: t('模型输出被截断；查看本轮输出上限与服务商限制。', 'Model output was truncated; check the output limit and service restrictions.'),
        MODEL_HISTORY_UNAVAILABLE: t('服务缺少工具思考回传所需信息，未静默关闭思考。', 'Required thinking/tool history is unavailable; thinking was not silently disabled.'),
        TIMEOUT: t('任务超时，正在等待上游清理。', 'Task timed out; awaiting upstream cleanup.'),
        BUDGET_EXCEEDED: t('已达到任务预算，未继续调用。', 'Run budget reached; no further calls.'),
        NO_CANDIDATE: t('模型未提交有效配置候选，未生成可用草稿。', 'No valid configuration candidate was submitted.'),
        RESULT_NEEDS_REVIEW: t('未能发布可信产物，证据可能缺失或已变化，请重新排查或生成。', 'Could not publish a verified artifact; evidence may be missing or changed. Run again.'),
        AUTO_APPLY_REQUIRES_REVIEW: t('本轮有未解决的工具失败，已保留草稿但未自动应用；请检查后手动确认。', 'A tool failure remains unresolved. Drafts were kept but not applied automatically; review and confirm them manually.'),
    };
    function showError(error) {
        const code = error?.message;
        if (code?.startsWith('ACTION_') || code === 'WRITE_UNAVAILABLE') { errors.textContent = t('应用请求不可用、已处理或已过期。请检查当前草稿并重新生成预览。', 'Application request unavailable, consumed or stale. Check the draft and generate a fresh preview.'); return; }
        if (code === 'INTERACTION_PENDING') { errors.textContent = t('请先回答或取消当前澄清问题。', 'Answer or cancel the pending clarification first.'); return; }
        if (code === 'INTERACTION_STALE' || code === 'INVALID_INTERACTION_ANSWER') { errors.textContent = t('问题已失效或回答无效；请检查当前问题，回答最多2000字符。', 'The question expired or the answer is invalid; check the active question (maximum 2000 characters).'); return; }
        if (code === 'INVALID_INSTRUCTION_CONFIG' || code === 'INSTRUCTION_CONFIG_SAVE_FAILED' || code === 'INSTRUCTION_CONFIG_UNAVAILABLE') { errors.textContent = t('行为偏好超出限制或未能确认保存；原配置仍有效，请检查并重试。', 'Behavior preferences exceed limits or saving was not confirmed; previous configuration remains active. Check and retry.'); return; }
        if (notices[code]) { errors.textContent = notices[code]; return; }
        if (code === 'NOTHING_TO_SUMMARIZE') { errors.textContent = t('暂无可整理的完整旧问答；保留近期问答，单次过长的问答不会截断整理。', 'No eligible complete older turns. Recent turns are retained and oversized turns are not split.'); return; }
        if (code === 'INVALID_CONTEXT_CONFIG' || code === 'CONTEXT_CONFIG_SAVE_FAILED') { errors.textContent = t('上下文设置无效或保存失败，仍使用原配置。', 'Invalid context settings or save failed; previous configuration remains active.'); return; }
        if (code?.startsWith('HISTORY_')) { errors.textContent = code === 'HISTORY_PERMISSION_REQUIRED' ? t('旧对话含需授权的资料。可在会话工具中选择本次不带历史、在配置中授权，或新建对话。', 'Old history requires authorization. Omit history in conversation tools, authorize in settings, or start a new conversation.') : code === 'HISTORY_CAPACITY' ? t('已达到历史容量限制，请导出备份；单会话满时可新建对话。', 'History capacity reached. Export a backup; start a new conversation if this one is full.') : t('历史操作未完成，未自动覆盖或清除记录。请检查存储状态并重试。', 'History operation failed; records were not automatically overwritten or cleared. Check storage and retry.'); return; }
        if (code === 'CREDENTIAL_SAVE_FAILED') { errors.textContent = t('未能确认密钥设置已保存，请检查酒馆存储状态后重试。', 'Could not confirm credential persistence. Check ST storage and retry.'); return; }
        if (code === 'INVALID_RUN_CONFIG' || code === 'RUN_CONFIG_SAVE_FAILED') { errors.textContent = code === 'INVALID_RUN_CONFIG' ? t('预算必须是标注范围内的整数，未保存。', 'Budgets must be integers within the displayed bounds; not saved.') : t('未能确认预算保存，仍使用原配置。', 'Budget save was not confirmed; previous configuration remains active.'); return; }
        if (code === 'RECOVERY_STALE' || code === 'DRAFT_EXISTS') { errors.textContent = code === 'DRAFT_EXISTS' ? t('输入框已有草稿；先处理或清空草稿，再恢复旧问题。', 'The composer already has a draft. Keep or clear it before restoring the old question.') : t('这条失败记录已变化，不能恢复旧问题。', 'The failed record changed; the old question cannot be restored.'); return; }
        const known = { CONSENT_REQUIRED: t('请确认本次数据外发范围。', 'Confirm data sharing for this request.'), FIELD_SCOPE_REQUIRED: t('请选择本次可修改的字段。', 'Choose fields for this draft.'), CHAT_REQUIRED: t('请先打开聊天。', 'Open a chat first.'), EMPTY_INPUT: t('请输入问题。', 'Enter a question.'), NOT_READY: t('请先启用连接，或等待任务清理结束。', 'Enable a connection or wait for cleanup.'), STALE_DRAFT: t('草稿或配置已变化，请重新生成预览。', 'Draft/settings changed; generate a fresh preview.') };
        errors.textContent = known[code] || t('操作未完成，请检查连接配置、状态和输入。网络失败也可能是 CORS，禁止据此断言密钥错误。', 'Operation failed. Check connection, state and input. Network failure may be CORS, not necessarily invalid credentials.');
    }
    async function act(fn) { errors.textContent = ''; try { await fn(); } catch (e) { showError(e); } if (!disposed && (standalone || shell.open)) render(); }
    function render() {
        if (disposed) return; const s = controller.snapshot();
        const switchedView = scrollKey !== s.viewKey;
        if (switchedView && scrollKey) controller.setScrollPosition?.(scrollKey, transcript.scrollTop);
        scrollKey = s.viewKey;
        historyView.render(s);
        contextView.render(s);
        receiptView.render(s);
        instructionView.render(s);
        interactionView.render(s);
        permissionView.render(s);
        fullAccessToggle.checked = s.fullAccess === true; fullAccessToggle.disabled = !s.enabled || s.resetting || s.busy;
        fullAccessBanner.hidden = s.fullAccess !== true;
        const config = s.runConfig || RUN_DEFAULTS, configSignature = JSON.stringify(config);
        if (configSignature !== lastRunConfig) { for (const f of budgetFields) f.input.value = String(config[f.name] / f.scale); lastRunConfig = configSignature; }
        saveBudget.disabled = resetBudget.disabled = !!s.savingRunConfig || s.resetting;
        const view = s.viewToken;
        if (view !== lastView) { resetAuthorization(); lastView = view; }
        if (s.connection && JSON.stringify(s.connection) !== lastConnection) { endpoint.value = s.connection.endpoint; model.value = s.connection.model; thinking.checked = s.connection.thinking; rememberKey.checked = s.connection.remembered !== false; autoConnect.checked = s.connection.autoConnect === true; lastConnection = JSON.stringify(s.connection); }
        activeConnection.textContent = s.connection ? t('当前请求目标：', 'Active request destination: ') + s.connection.model + ' · ' + s.connection.endpoint : '';
        const task = taskCatalog[s.mode], granted = s.permissions?.[s.mode === 'chat' ? 'chat' : 'diagnostics'] === true;
        consentText.textContent = s.mode === 'chat' ? t(...task.consent) : t('允许本连接会话内读取记忆与导演白名单配置、匿名统计、运行状态和所选配置草稿；不含角色身份或聊天正文', 'Allow whitelist memory/director settings, anonymous counts, runtime state and selected drafts for this connection session; no character identities or chat bodies');
        consentLabel.hidden = granted; withoutData.hidden = s.mode !== 'chat';
        diagnosticPermission.checked = !!s.permissions?.diagnostics; chatPermission.checked = !!s.permissions?.chat; extendedPermission.checked = !!s.permissions?.extended;
        diagnosticPermission.disabled = !s.enabled || s.resetting; chatPermission.disabled = !s.enabled || s.resetting || !s.hasChat;
        extendedPermission.disabled = chatPermission.disabled;
        permissionSummary.textContent = t('可读取：', 'Access: ') + [t('内置资料', 'Built-in docs'), ...(s.permissions?.diagnostics ? [t('诊断信息', 'Diagnostics')] : []), ...(s.permissions?.chat ? [t('当前聊天资料', 'This chat')] : [])].join(' · ');
        if (s.permissions?.extended) permissionSummary.textContent += t(' · 扩展剧情上下文', ' · Extended story context');
        if (unified) permissionSummary.textContent = t('资料权限 · ', 'Data access · ') + (s.sourceGrants?.length ? t('已允许 ', 'Allowed: ') + s.sourceGrants.length + t(' 项', ' sources') : t('需要时由暮羽申请', 'Muyu asks when needed'));
        if (s.fullAccess) permissionSummary.textContent = t('⚠ 全权限模式已开启', '⚠ Full-access mode enabled');
        savedKeyStatus.textContent = s.savedConnection ? t('已保存密钥；相同接口可留空使用。', 'Saved key available; leave blank for the same endpoint.') : t('未保存密钥', 'No saved key');
        forgetKey.disabled = !s.savedConnection || s.resetting;
        if (!lastConnection && s.savedConnection && !s.connection) { endpoint.value = s.savedConnection.endpoint; model.value = s.savedConnection.model; thinking.checked = s.savedConnection.thinking; rememberKey.checked = true; autoConnect.checked = s.savedConnection.autoConnect === true; lastConnection = 'saved'; }
        status.textContent = [s.enabled ? t('已启用', 'Enabled') : t('未启用', 'Disabled'), (unified ? s.targetKind === 'chat' : task.scope === 'chat') ? t('绑定：当前聊天', 'Bound to current chat') : t('绑定：全局会话', 'Bound to global conversation'), s.resetting || s.draining ? t('等待上游清理…', 'Waiting for cleanup…') : s.busy ? t('运行中…', 'Running…') : t('空闲', 'Idle'), notices[s.notice] || ''].filter(Boolean).join(' · ');
        const latestProcess = s.runs.at(-1)?.process;
        usageText.textContent = formatBudget(latestProcess?.budget, lang);
        if (s.taskUsage?.segments > 1) usageText.textContent += ` · ${t('任务累计模型/工具调用', 'Task total model/tool calls')}: ${s.taskUsage.modelCalls}/${s.taskUsage.toolCalls} · ${t('执行段', 'Segments')}: ${s.taskUsage.segments}`;
        if (latestProcess?.budget?.reason) status.textContent += ' · ' + budgetReasonLabel(latestProcess.budget.reason, lang);
        if (s.occupiedElsewhere) status.textContent += t(' · 其他会话任务占用中', ' · Another session occupies the runtime');
        else if (latestProcess) status.textContent += ' · ' + processLabel(latestProcess, lang);
        scope.hidden = s.mode !== 'draft'; followLabel.hidden = s.mode !== 'draft';
        mode.value = s.mode; setupBar.hidden = setup.hidden = s.enabled; welcome.hidden = s.enabled && s.messages.length > 0;
        if (s.readOnly) status.textContent = t('查看历史 · 只读，不读取当前聊天，也不发送给模型', 'History viewer · Read-only; no current-chat reads or model requests');
        if (s.interaction?.status === 'pending') status.textContent = s.interaction.kind === 'permission' ? t('等待资料授权 · 请选择允许或拒绝', 'Waiting for data access · Allow or deny') : t('等待你的回答 · 请在上方问题卡中补充，或取消澄清', 'Waiting for your answer · Use the question card above, or cancel clarification');
        if (s.interaction?.kind === 'permission' && s.interaction.status === 'pending') status.textContent = t('等待读取授权 · 可允许、拒绝并继续，或取消任务', 'Waiting for read permission · Allow, deny and continue, or cancel task');
        recoveryRunId = s.recovery?.runId || null;
        recoveryBar.hidden = !recoveryRunId;
        restoreInput.disabled = !recoveryRunId || !!s.input?.trim() || !!s.busy || !!s.resetting;
        recoveryNote.textContent = s.recovery?.possibleEffects
            ? t('仅复制原问题，不自动重试。此前操作结果可能不明；重新发送前请核对实际状态。', 'Copies the question only; no automatic retry. Earlier effects may be unknown, so verify actual state before sending again.')
            : t('仅复制原问题，不自动重试或恢复旧授权。可先修改，再自行发送。', 'Copies the question only; no automatic retry or restored grants. Edit it before sending if needed.');
        input.disabled = !!s.readOnly;
        send.disabled = s.readOnly || s.busy || s.resetting || s.history?.loading || s.enabled && task.scope === 'chat' && !s.hasChat; stop.disabled = !s.busy || s.resetting;
        if (s.interaction?.status === 'pending') { send.disabled = true; resetAuthorization(); }
        confirm.disabled = send.disabled; stop.hidden = !!s.readOnly || !s.busy && !s.resetting;
        if (s.readOnly) { stop.disabled = true; resetAuthorization(); }
        connect.disabled = disable.disabled = s.resetting; if (input.value !== s.input) input.value = s.input;
        const nearBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 60;
        const nextHistory = JSON.stringify([s.viewToken, s.messages]);
        const historyChanged = historySignature !== nextHistory;
        processView.retain(new Set(s.runs.map(r => r.id)));
        if (historySignature !== nextHistory) {
            historySignature = nextHistory; history.replaceChildren(); processAnchors.clear();
            let permissionRecord = null;
            for (const [index, message] of s.messages.entries()) {
                const next = s.messages[index + 1];
                const requestPrefix = ['读取授权申请 / Read permission request: ', '代码执行申请 / Code execution request: '].find(prefix => message.role === 'assistant' && message.content.startsWith(prefix));
                const requestTitle = requestPrefix ? message.content.split('\n')[0].slice(requestPrefix.length) : null;
                const paired = requestTitle && next?.role === 'user' && ['拒绝读取 / Read denied', '允许本任务 / Allow task', '允许此聊天 / Allow chat'].some(label => next.content === `${label}: ${requestTitle}`);
                if (paired) {
                    permissionRecord = node('details', '', history);
                    node('summary', t('资料授权记录（展开查看）', 'Data access record (expand)'), permissionRecord);
                }
                const p = node('div', '', permissionRecord || history); p.className = message.role === 'user' ? 'gd-muyu-message gd-muyu-user' : 'gd-muyu-message gd-muyu-assistant';
                const author = node('strong', message.role === 'user' ? t('你：', 'You: ') : t('暮羽：', 'Muyu: '), p); author.className = 'gd-muyu-author';
                const content = node('div', '', p); content.className = 'gd-muyu-markdown'; renderMarkdown(content, message.content);
                if (message.role === 'user' && message.runId) processAnchors.set(message.runId, { root: node('div', '', history), child: null });
                if (!paired) permissionRecord = null;
            }
        }
        for (const run of s.runs) {
            const anchor = processAnchors.get(run.id); if (!anchor) continue;
            const detail = processView.update(run, s.artifacts.some(a => a.sourceRunId === run.id || a.content?.producedByRunId === run.id), s.mode !== 'chat');
            if (detail && anchor.child !== detail) { anchor.root.append(detail); anchor.child = detail; }
        }
        cards.replaceChildren(); const selected = follow.value; follow.replaceChildren(); const none = node('option', t('新任务', 'New task'), follow); none.value = '';
        for (const artifact of s.artifacts) {
            const card = node('section', '', cards); card.className = 'gd-muyu-card';
            node('strong', (artifact.kind === 'report' ? t('排查报告', 'Diagnostic report') : artifact.kind === 'task-plan' ? t('任务方案', 'Task plan') : artifact.kind === 'variable-draft' ? t('变量草稿', 'Variable draft') : artifact.kind === 'task-bundle' ? t('整单草稿', 'Operation bundle') : artifact.kind === 'profile-draft' ? t('配置档草稿', 'Profile draft') : t('配置草稿', 'Configuration draft')) + ' · v' + artifact.revision, card);
            if (artifact.kind === 'report') {
                for (const f of artifact.content.findings) node('p', `${f.kind} · ${f.code}: ${f.text}`, card);
                node('small', t('这是生成时的证据快照，不是实时状态。', 'Snapshot at generation time, not live state.'), card);
                const director = artifact.content.module === 'director';
                button(director ? t('前往导演设置', 'Open director settings') : t('前往记忆设置', 'Open memory settings'), card).onclick = director ? navigateDirector : navigateMemory;
            } else if (artifact.kind === 'task-plan') {
                const plan = artifact.content.plan;
                const availability = {
                    'read-only': t('仅可读取', 'Read only'),
                    'draft-only': t('仅可预览草稿', 'Draft preview only'),
                    'single-draft-approval-required': t('需单份草稿另行批准', 'Separate approval for one draft'),
                    'bundle-or-separate-draft-approval-required': t('需精确整单或单份草稿另行批准', 'Separate approval for an exact bundle or draft'),
                    'not-available': t('当前不可执行', 'Not available yet'),
                    'separate-code-approval-required': t('代码操作需另行审批', 'Code action requires separate approval'),
                };
                node('p', plan.goal, card);
                node('small', t('仅规划，未读取下列资料，也未修改任何内容。预计操作并非当前已具备的写入能力。', 'Proposal only: the sources below have not been read, and nothing was changed. Proposed work is not a write capability.'), card);
                for (const step of plan.steps) node('p', `${step.title} · ${availability[step.availability] || step.availability}: ${step.detail}`, card);
                if (plan.risks?.length) node('p', t('风险：', 'Risks: ') + plan.risks.join('；'), card);
                if (plan.unknowns.length) node('p', t('待核实：', 'Unknowns: ') + plan.unknowns.join('；'), card);
                node('p', t('本任务拟读取：', 'Sources requested for this task: ') + (plan.sources.map(permissionTitle).join('；') || t('无', 'None')), card);
                const reviewed = s.approvedPlans?.includes(artifact.id);
                const declined = s.declinedPlans?.includes(artifact.id);
                const invalid = s.invalidPlans?.includes(artifact.id);
                node('small', invalid ? t('任务已停止，本方案不能再用于授权。', 'Task stopped; this plan can no longer grant access.') : reviewed ? t('本次已允许读取上述来源；任务结束后授权失效，未授予写入权限。', 'These sources were allowed for this task; access expires when the task ends, and no write permission was granted.') : declined ? t('已拒绝本方案的资料读取；不会继续执行或改用其他来源。', 'Reads for this plan were declined; it will not continue or use alternate sources.') : t('批准只允许本任务读取列出的来源并继续核对，不批准任何修改；切换聊天或连接后失效。', 'Approval permits only these sources for this task and continues review, not any write. It expires on chat or connection change.'), card);
                if (!reviewed && !declined && !invalid) {
                    const approve = button(t('允许读取并继续规划', 'Allow reads and continue planning'), card);
                    approve.disabled = s.busy || s.resetting || s.readOnly;
                    approve.onclick = () => act(() => controller.approveTaskPlanReads(artifact.id, artifact.revision));
                    const decline = button(t('不允许读取', 'Decline reads'), card);
                    decline.disabled = s.busy || s.resetting || s.readOnly;
                    decline.onclick = () => act(() => controller.declineTaskPlanReads(artifact.id, artifact.revision));
                }
            } else if (artifact.kind === 'task-bundle') {
                node('small', t('仅预览，未修改内容。执行顺序：当前聊天变量 → 全局配置。', 'Preview only; no changes yet. Order: current-chat variables → global settings.'), card);
                for (const variable of artifact.content.variables) {
                    node('strong', t('当前聊天变量：', 'Current-chat variable: ') + variable.preview.id, card);
                    for (const diff of variable.preview.diff) node('p', `${diff.field}: ${JSON.stringify(diff.before)} → ${JSON.stringify(diff.after)}`, card);
                }
                if (artifact.content.settings) {
                    node('strong', t('全局配置：影响所有聊天', 'Global settings: affects all chats'), card);
                    for (const diff of artifact.content.settings.preview.diff) node('p', `${diff.field}: ${diff.before} → ${diff.after}`, card);
                    for (const warning of artifact.content.settings.preview.warnings) node('p', warning, card);
                }
                const recheck = button(t('重新校验整单', 'Revalidate bundle'), card); recheck.disabled = s.busy || s.resetting;
                recheck.onclick = () => act(() => controller.revalidate(artifact.id, artifact.revision));
                renderTaskBundleApply({ doc, card, artifact, state: s, controller, act, lang });
            } else if (artifact.kind === 'profile-draft') {
                node('p', artifact.content.name, card);
                if (artifact.content.description) node('small', artifact.content.description, card);
                for (const [field, value] of Object.entries(artifact.content.settings)) node('p', `${field}: ${JSON.stringify(value)}`, card);
                for (const warning of artifact.content.warnings) node('small', warning, card);
                node('small', t('这是一份可复用的局部配置档；保存到库不会修改当前设置。以后应用配置档时，以上字段将影响所有聊天，未列出的字段保持不变。', 'Reusable partial profile. Saving does not change active settings. Applying it later affects all chats for the listed fields; omitted fields stay unchanged.'), card);
                const recheck = button(t('重新校验配置档', 'Revalidate profile'), card); recheck.disabled = s.busy || s.resetting;
                recheck.onclick = () => act(() => controller.revalidate(artifact.id, artifact.revision));
                renderProfileSave({ doc, card, artifact, state: s, controller, act, lang });
            } else if (artifact.kind === 'variable-draft') {
                const preview = artifact.content.preview;
                node('p', t('当前聊天变量：', 'Current-chat variable: ') + preview.id, card);
                for (const diff of preview.diff) node('p', `${diff.field}: ${JSON.stringify(diff.before)} → ${JSON.stringify(diff.after)}`, card);
                node('small', t('草稿本身未修改或保存变量；应用前须核对并单独确认。', 'The draft itself changed or saved nothing; review and confirm separately before applying.'), card);
                const recheck = button(t('重新校验', 'Revalidate'), card); recheck.disabled = s.busy || s.resetting;
                recheck.onclick = () => act(() => controller.revalidate(artifact.id, artifact.revision));
                renderVariableApply({ doc, card, artifact, state: s, controller, act, lang });
            } else {
                for (const d of artifact.content.preview.diff) node('p', `${d.field}: ${d.before} → ${d.after}`, card);
                const operation = s.configActions?.find(r => r.artifactId === artifact.id && r.revision === artifact.revision);
                const attempted = operation && !['pending', 'cancelled', 'expired', 'not_executed'].includes(operation.status);
                node('p', attempted ? t('上方为本次操作的原始差异；实际结果见下方。', 'Original operation diff above; see actual result below.') : artifact.content.preview.notice, card); node('p', artifact.content.preview.warnings.join(' · '), card);
                if (artifact.content.preview.impact) {
                    node('small', t('当前聊天记忆仓库中的角色序号；不向模型发送角色标识或记忆正文。', 'Character slots in this chat memory store; identities and memory text are not sent to the model.'), card);
                    for (const row of artifact.content.preview.impact.characters) node('p', t(`角色序号 ${row.slot}：${row.before} → ${row.before - row.remove}（裁剪 ${row.remove}）`, `Character slot ${row.slot}: ${row.before} → ${row.before - row.remove} (prune ${row.remove})`), card);
                }
                if (!attempted) node('p', artifact.validation?.status === 'stale' ? t('过期，需重新生成', 'Stale; regenerate') : artifact.validation ? t('已校验当时基线；使用前需复核，未应用', 'Validated against saved baseline; recheck before use. Not applied.') : t('未校验，未应用', 'Not validated; not applied'), card);
                const recheck = button(t('重新校验', 'Revalidate'), card); recheck.disabled = s.busy || s.resetting; recheck.onclick = () => act(() => controller.revalidate(artifact.id, artifact.revision));
                renderConfigApply({ doc, card, artifact, state: s, controller, act, lang });
                const option = node('option', `${artifact.id} · v${artifact.revision}`, follow); option.value = artifact.id;
            }
        }
        if ([...follow.options].some(o => o.value === selected)) follow.value = selected;
        if (switchedView) transcript.scrollTop = s.scrollTop ?? transcript.scrollHeight;
        else if (nearBottom && historyChanged) transcript.scrollTop = transcript.scrollHeight;
    }
    const subscribe = () => { if (!unsubscribe) unsubscribe = controller.subscribe(render).unsubscribe; render(); };
    shell.addEventListener('toggle', () => { if (disposed) return; if (shell.open) subscribe(); else { unsubscribe?.(); unsubscribe = null; key.value = ''; } });
    if (standalone) subscribe();
    mode.onchange = () => act(() => controller.setMode(mode.value));
    saveBudget.onclick = () => act(async () => {
        const value = {};
        for (const f of budgetFields) { const n = Number(f.input.value); if (!f.input.value.trim() || !Number.isInteger(n)) throw Error('INVALID_RUN_CONFIG'); value[f.name] = n * f.scale; }
        await controller.saveRunConfig(value); lastRunConfig = '';
    });
    resetBudget.onclick = () => act(async () => { await controller.saveRunConfig({ ...RUN_DEFAULTS }); lastRunConfig = ''; });
    input.oninput = () => { try { controller.setInput(input.value); } catch (e) { showError(e); } };
    send.onclick = () => act(() => {
        if (!input.value.trim()) throw new Error('EMPTY_INPUT');
        controller.setInput(input.value);
        const s = controller.snapshot();
        if (!s.enabled) {
            showSettings(true, 'connection');
            const notice = t('请先配置并启用模型接口；刚才输入的消息已保留，返回聊天后可直接发送。', 'Configure and enable a model connection first. Your unsent message is preserved; return to chat to send it.');
            errors.textContent = notice;
            globalThis.toastr?.warning?.(notice);
            return;
        }
        if (s.mode === 'assistant' || s.mode === 'chat' || s.mode !== 'draft' && s.permissions?.diagnostics) { controller.send(); resetAuthorization(); }
        else { authorization.hidden = false; confirm.focus?.(); }
    });
    confirm.onclick = () => act(() => { controller.setInput(input.value); controller.send({ consent: consent.checked, fields: fields.filter(([, f]) => f.checked).map(([name]) => name), artifactId: follow.value || null }); resetAuthorization(); });
    withoutData.onclick = () => act(() => { controller.setInput(input.value); controller.send(); resetAuthorization(); });
    diagnosticPermission.onchange = () => act(() => diagnosticPermission.checked ? controller.grantPermission('diagnostics') : controller.revokePermission('diagnostics'));
    chatPermission.onchange = () => act(() => chatPermission.checked ? controller.grantPermission('chat') : controller.revokePermission('chat'));
    extendedPermission.onchange = () => act(() => extendedPermission.checked ? controller.grantPermission('extended') : controller.revokePermission('extended'));
    fullAccessToggle.onchange = () => {
        const enabled = fullAccessToggle.checked;
        if (enabled) {
            let confirmed = false;
            try { confirmed = doc.defaultView?.confirm?.(t('危险：暮羽将无需逐次确认即可读取当前聊天资料、执行已注册 Provider 代码，并应用其提出的配置与整单修改。代码可能联网、产生费用或更改数据；保存可能无法撤销。仅本连接有效。确定开启？', 'Danger: Muyu may read chat data, execute registered Provider code, and apply proposed settings/bundle changes without further confirmation. Code may use the network, incur costs or change data; saves may not be reversible. This connection only. Enable?')) === true; } catch { /* Fail closed if confirmation is unavailable. */ }
            if (!confirmed) { fullAccessToggle.checked = false; return; }
        }
        act(() => controller.setFullAccess(enabled));
    };
    forgetKey.onclick = () => act(async () => { await controller.forgetCredential(); rememberKey.checked = false; autoConnect.checked = false; key.value = ''; });
    cancelAuth.onclick = () => { resetAuthorization(); input.focus?.(); };
    stop.onclick = () => act(() => controller.stop());
    connect.onclick = () => act(async () => { const apiKey = key.value; await controller.configure({ endpoint: endpoint.value.trim(), apiKey, model: model.value.trim(), profile: 'deepseek', thinking: thinking.checked, supportsTools: true, rememberKey: rememberKey.checked, autoConnect: autoConnect.checked && rememberKey.checked }); key.value = ''; if (!disposed) showSettings(false); });
    disable.onclick = () => act(async () => { await controller.disable(); autoConnect.checked = false; lastConnection = null; });
    input.onkeydown = event => { if (event.ctrlKey && event.key === 'Enter' && !send.disabled) { event.preventDefault(); send.click(); } };
    render();
    const dispose = () => { if (disposed) return; disposed = true; if (scrollKey) controller.setScrollPosition?.(scrollKey, transcript.scrollTop); unsubscribe?.(); historyView.dispose(); processView.clear(); key.value = ''; gear.remove(); shell.remove(); root.classList.remove?.('gd-muyu-floating'); if (root.__gdMuyuDispose === dispose) delete root.__gdMuyuDispose; };
    root.__gdMuyuDispose = dispose; return dispose;
}
