import test from 'node:test';
import assert from 'node:assert/strict';
import { mountMuyuPanel } from '../../muyu/ui/panel.js';
import { importPreview } from '../../muyu/sessions/exchange.js';

// Minimal native DOM contract; does not assert CSS geometry or browser layout.
class Element {
    constructor(tag, doc) { this.tag = tag; this.ownerDocument = doc; this.children = []; this.attrs = {}; this.events = {}; this.value = ''; this.checked = false; this.classList = { add() {} }; }
    append(el) { if (el.parent) el.remove(); this.children.push(el); el.parent = this; }
    replaceChildren() { this.children = []; }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k]; }
    focus() { this.ownerDocument.activeElement = this; }
    addEventListener(k, fn) { this.events[k] = fn; }
    remove() { this.parent.children = this.parent.children.filter(e => e !== this); }
    get options() { return this.children.filter(e => e.tag === 'option'); }
    click() { if (!this.disabled) return this.onclick?.(); }
    toggle(open) { this.open = open; this.events.toggle?.(); }
}
function fixture(lang = 'zh', standalone = false, options = {}) {
    const doc = { createElement: tag => new Element(tag, doc) }, root = doc.createElement('div');
    const state = { viewToken: 1, enabled: false, mode: options.initialMode || 'memory', input: '', hasChat: true, messages: [], runs: [], artifacts: [] };
    const listeners = new Set(), sent = [], configs = []; let stops = 0;
    const emit = () => { for (const fn of listeners) fn(); };
    const controller = {
        snapshot: () => structuredClone(state), subscribe(fn) { listeners.add(fn); return { unsubscribe: () => listeners.delete(fn) }; },
        setMode(mode) { state.mode = mode; state.viewToken++; emit(); }, setInput(input) { state.input = input; },
        send(options = {}) { if (!options.consent && !state.permissions?.diagnostics && !state.permissions?.chat && !state.permissions?.chatDecided) throw new Error('CONSENT_REQUIRED'); sent.push(options); state.input = ''; state.busy = true; emit(); },
        grantPermission(kind) { state.permissions ||= {}; state.permissions[kind] = true; emit(); },
        revokePermission(kind) { state.permissions[kind] = false; state.messages = []; emit(); },
        forgetCredential() { state.savedConnection = null; emit(); },
        saveRunConfig(value) { state.runConfig = structuredClone(value); emit(); },
        newSession() { state.history.sessionId = 'new'; state.history.sessions.push({ id: 'new', title: '' }); state.messages = []; state.input = ''; state.viewToken++; emit(); },
        selectSession(id) { state.history.sessionId = id; state.viewToken++; emit(); },
        openSession(id) { state.history.sessionId = id; state.viewToken++; emit(); },
        setHistoryFilters(value) { state.history.filters = { range: 'current', archive: 'active', task: '', query: '', ...state.history.filters, ...value }; emit(); },
        renameSession(id, title) { state.history.selected.title = title; state.history.sessions.find(s => s.id === id).title = title; emit(); },
        archiveSession(id, value) { state.history.selected.archived = value; state.readOnly = value; emit(); },
        deleteSession(id) { state.history.sessions = state.history.sessions.filter(s => s.id !== id); state.history.sessionId = ''; emit(); },
        setHistoryEnabled(value) { state.history.enabled = value; emit(); }, retryHistory() { state.history.error = null; emit(); },
        configure(config) { configs.push(config); state.enabled = true; emit(); }, disable() { state.enabled = false; emit(); }, stop() { stops++; state.busy = false; emit(); },
    };
    const all = (el = root) => [el, ...el.children.flatMap(e => all(e))];
    // A settings editor now also uses textarea; existing interaction cases target the composer.
    const find = (tag, label) => all().find(e => e.tag === tag && (label === undefined || e.textContent === label) && (tag !== 'textarea' || label !== undefined || ['给暮羽的消息', 'Message to Muyu'].includes(e.parent?.textContent)));
    const mount = () => mountMuyuPanel(root, controller, { lang, standalone, ...options });
    mount(); return { root, state, controller, listeners, sent, configs, emit, find, all, mount, stops: () => stops };
}

function managedHistory() {
    return { available: true, enabled: true, loading: false, pending: 0, error: null, dirty: false, sessionId: 'old', persisted: true,
        selected: { id: 'old', title: 'Title', archived: false }, sessions: [{ id: 'old', title: 'Title' }], missingPermissions: [], omitted: 0 };
}

for (const lang of ['zh', 'en']) test(`Unified composer has no task picker, field checklist or broad permission toggles (${lang})`, async () => {
    const f = fixture(lang, true, { initialMode: 'assistant' });
    f.state.enabled = true; f.state.hasChat = false; f.state.targetKind = 'global'; f.state.input = 'hello';
    f.controller.send = value => { f.sent.push(value); }; f.emit();
    assert.equal(f.all().some(e => e.className === 'gd-muyu-mode'), false);
    assert.equal(f.all().some(e => e.className === 'gd-muyu-authorization'), false);
    assert.equal(f.find('fieldset'), undefined);
    assert.equal(f.all().some(e => e.textContent?.includes(lang === 'en' ? 'Plugin diagnostics (whitelist' : '插件诊断信息（白名单')), false);
    await f.find('button', lang === 'en' ? 'Send' : '发送').click(); assert.deepEqual(f.sent, [undefined]);
    f.state.interaction = { id: 'g', kind: 'permission', source: 'memoryConfig', reason: 'inspect', status: 'pending' };
    f.state.connection = { endpoint: 'https://example.test', model: 'fake' }; f.emit();
    assert.ok(f.find('button', lang === 'en' ? 'Allow this connection' : '允许本连接'));
    assert.ok(f.all().some(e => e.textContent?.includes(lang === 'en' ? 'global whitelist' : '全局白名单')));
    f.state.interaction = { id: 'code', kind: 'permission', source: 'providerExecution', providerId: 'myNotes', providerRevision: 'v1', reason: 'test', status: 'pending' };
    f.emit();
    assert.equal(f.find('button', lang === 'en' ? 'Allow this chat' : '允许此聊天').hidden, true);
    assert.ok(f.all().some(e => e.textContent?.includes(lang === 'en' ? 'Muyu requests code execution' : '暮羽请求执行代码')));
    assert.ok(f.all().some(e => e.textContent?.includes(lang === 'en' ? 'may change data' : '可能修改数据')));
    f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test(`Receipts remain distinct, inert on remount and gated before explanation (${lang})`, async () => {
    const f = fixture(lang, true); let explained = 0;
    f.state.enabled = true; f.state.permissions = { diagnostics: true };
    f.state.receipts = [{ operationId: 'op', artifactId: 'a', revision: 1, at: 1, status: 'outcome_unknown', diff: [], saveError: false, changed: false }];
    f.state.mode = 'draft'; f.state.canApplyConfig = true;
    f.state.configActions = [{ id: 'op', artifactId: 'a', revision: 1, status: 'outcome_unknown' }];
    f.state.artifacts = [{ id: 'a', revision: 1, kind: 'config-draft', content: { preview: { diff: [], warnings: [], notice: 'Draft' } } }];
    f.state.receiptExplanations = { op: 'succeeded' };
    f.controller.explainReceipt = id => { assert.equal(id, 'op'); explained++; };
    let checks = 0;
    f.controller.checkReceipt = id => { assert.equal(id, 'op'); checks++; f.state.configChecks = { op: { state: 'different', fields: [{ field: 'autoMemoryInterval', actual: '25', expected: '15' }], readAt: '2026-09-24T00:00:00Z' } }; f.emit(); };
    f.emit(); f.root.__gdMuyuDispose(); f.mount(); assert.equal(explained, 0);
    assert.equal(f.all().filter(e => e.textContent?.includes('1970-01-01T00:00:00.001Z')).length, 1, 'receipt body appears once');
    const status = f.all().find(e => e.textContent?.startsWith(lang === 'en' ? 'Explanation complete' : '解释完成'));
    assert.ok(status); assert.equal(status.parent.className, 'gd-muyu-receipt-actions');
    assert.equal(f.all().some(e => e.textContent?.includes('succeeded')), false);
    const label = lang === 'en' ? 'Ask Muyu to explain' : '让暮羽解释结果';
    await f.find('button', label).click(); assert.equal(explained, 1);
    await f.find('button', lang === 'en' ? 'Check current settings' : '核对当前配置').click(); assert.equal(checks, 1);
    assert.ok(f.all().some(e => e.textContent?.includes(lang === 'en' ? 'Different from proposed' : '读取时与提议值不一致')));
    f.state.permissions.diagnostics = false; f.emit(); assert.equal(f.find('button', label).disabled, true);
    f.state.readOnly = true; f.emit(); assert.equal(f.find('button', label), undefined);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test(`Config application requires a separate confirmation and keeps pending state on remount (${lang})`, async () => {
    const f = fixture(lang, true); let writes = 0;
    f.state.canApplyConfig = true; f.state.mode = 'draft';
    f.state.artifacts = [{ id: 'a', revision: 1, kind: 'config-draft', content: { preview: { diff: [{ field: 'autoMemoryInterval', before: '10', after: '15' }], notice: 'Draft only', warnings: [] } } }];
    f.controller.prepareConfigApply = () => { f.state.configActions = [{ id: 'op', artifactId: 'a', revision: 1, status: 'pending' }]; f.emit(); };
    f.controller.approveConfigApply = () => { writes++; f.state.configActions[0].status = 'applied_unconfirmed'; f.emit(); };
    f.emit(); await f.find('button', lang === 'en' ? 'Review and apply' : '查看并应用').click(); assert.equal(writes, 0);
    f.root.__gdMuyuDispose(); f.mount(); assert.equal(writes, 0);
    await f.find('button', lang === 'en' ? 'Apply these changes' : '应用这份修改').click(); assert.equal(writes, 1);
    assert.equal(f.find('button', lang === 'en' ? 'Apply these changes' : '应用这份修改'), undefined);
    assert.ok(f.all().some(e => e.textContent?.includes(lang === 'en' ? 'persistence unconfirmed' : '持久化保存未确认')));
    f.root.__gdMuyuDispose();
});

for (const lang of ['zh', 'en']) test(`Permission card has explicit decisions, survives remount and closes after one response (${lang})`, async () => {
    const f = fixture(lang, true); let answers = 0;
    f.state.interaction = { id: 'p1', kind: 'permission', source: 'chatHistory', reason: '<img> story', status: 'pending' };
    f.state.connection = { model: 'test', endpoint: 'https://example.test' };
    f.controller.answerPermission = (id, decision) => { assert.equal(id, 'p1'); assert.equal(decision, 'task'); answers++; f.state.interaction.status = 'granted'; f.emit(); };
    f.emit(); assert.equal(f.find('img'), undefined);
    assert.equal(f.find('button', lang === 'en' ? 'Send' : '发送').disabled, true);
    f.root.__gdMuyuDispose(); f.mount();
    const allow = f.find('button', lang === 'en' ? 'Allow this task' : '允许本任务');
    assert.equal(allow.parent.parent.hidden, false);
    await allow.click(); await allow.click(); assert.equal(answers, 1);
    assert.equal(allow.parent.parent.hidden, true); assert.equal(f.sent.length, 0);
    f.root.__gdMuyuDispose();
});

test('Chat send no longer requires a blanket authorization screen', async () => {
    const f = fixture('en', true); let calls = 0;
    f.state.enabled = true; f.state.mode = 'chat'; f.state.permissions = { chat: false };
    f.controller.send = () => { calls++; }; f.emit();
    f.find('textarea').value = 'hello'; await f.find('button', 'Send').click(); assert.equal(calls, 1);
    f.root.__gdMuyuDispose();
});

test('Clarification choices only edit a draft; explicit answer submits once and survives view remount', async () => {
    const f = fixture('en', true); let answered = 0;
    f.state.interaction = { id: 'q1', status: 'pending', question: '<img>Which part?', options: ['Frequency', 'Content'], draft: '' };
    f.controller.setInteractionDraft = (id, draft) => { assert.equal(id, 'q1'); f.state.interaction.draft = draft; f.emit(); };
    f.controller.answerInteraction = () => { answered++; f.state.interaction.status = 'answered'; f.state.interaction.draft = ''; f.emit(); };
    f.emit(); assert.equal(f.find('button', 'Send').disabled, true); assert.equal(f.find('button', 'Answer and continue').disabled, true);
    await f.find('button', 'Frequency').click(); assert.equal(answered, 0); assert.equal(f.state.interaction.draft, 'Frequency');
    f.root.__gdMuyuDispose(); f.mount();
    const editor = f.all().find(e => e.tag === 'textarea' && e.parent.textContent === 'Your answer');
    assert.equal(editor.value, 'Frequency'); assert.equal(f.find('img'), undefined);
    await f.find('button', 'Answer and continue').click(); await f.find('button', 'Answer and continue').click();
    assert.equal(answered, 1); assert.equal(f.sent.length, 0);
    assert.equal(f.all().find(e => e.className === 'gd-muyu-interaction').hidden, true);
    f.root.__gdMuyuDispose(); f.mount();
    assert.equal(f.all().find(e => e.className === 'gd-muyu-interaction').hidden, true);
    f.root.__gdMuyuDispose();
});

test('Closed clarification cards show only status; cumulative usage belongs to conversation tools', () => {
    const f = fixture('en', true);
    f.state.taskUsage = { segments: 2, modelCalls: 2, toolCalls: 1 };
    for (const status of ['cancelled', 'expired']) {
        f.state.interaction = { id: 'q1', status, question: 'Which part?', options: [], draft: '' }; f.emit();
        const card = f.all().find(e => e.className === 'gd-muyu-interaction');
        assert.equal(card.hidden, false);
        assert.ok(card.children.filter(e => e.getAttribute('role') !== 'status').every(e => e.hidden));
        assert.match(card.children.find(e => e.getAttribute('role') === 'status').textContent, /Cancelled|Expired/);
        assert.ok(f.all().some(e => e.textContent?.includes('Task total model/tool calls: 2/1')));
    }
    f.root.__gdMuyuDispose();
});

test('Floating rail releases space in settings, restores it on return and cleans up without business calls', async () => {
    const changes = [], f = fixture('en', true, { setSidebarOpen: value => changes.push(value) });
    f.state.history = managedHistory(); f.emit();
    assert.equal(changes.at(-1), false);
    await f.find('button', 'History').click(); assert.equal(changes.at(-1), true);
    const box = f.all().find(e => e.className === 'gd-muyu-input-box');
    assert.ok(f.all(box).includes(f.find('textarea')));
    assert.ok(f.all(box).includes(f.find('button', 'Send')));
    f.find('textarea').value = 'keep my draft'; f.find('textarea').oninput();
    await f.find('button', '⚙').click(); assert.equal(changes.at(-1), false);
    await f.find('button', 'Back to chat').click(); assert.equal(changes.at(-1), true);
    assert.equal(f.find('textarea').value, 'keep my draft');
    const sidebar = f.find('aside');
    await f.all(sidebar).find(e => e.textContent === 'Back to chat').click();
    assert.equal(changes.at(-1), false); assert.equal(sidebar.hidden, true);
    f.root.__gdMuyuDispose(); assert.equal(changes.at(-1), false); assert.equal(f.sent.length, 0);
});

for (const lang of ['zh', 'en']) test(`Settings categories preserve editors and route shortcuts without execution (${lang})`, async () => {
    const f = fixture(lang, true), en = lang === 'en';
    const pages = f.all().filter(e => e.className === 'gd-muyu-settings-page');
    const [connection, data, behavior, limits] = pages;
    assert.equal(pages.length, 4); assert.equal(connection.hidden, false);
    assert.ok(pages.slice(1).every(e => e.hidden));
    const endpoint = f.all(connection).find(e => e.type === 'url');
    const budget = f.all(limits).find(e => e.type === 'number');
    assert.ok(endpoint); assert.ok(budget);
    assert.ok(f.all(data).some(e => e.textContent === (en ? 'Conversation history' : '对话历史')));
    assert.ok(f.all(data).some(e => e.textContent === (en ? 'Context and permissions' : '上下文与权限')));
    assert.ok(f.all(behavior).some(e => e.tag === 'textarea'));
    endpoint.value = 'https://draft.invalid'; budget.value = '7';
    const composer = f.all().find(e => e.className === 'gd-muyu-composer');
    const tools = f.all().find(e => e.className === 'gd-muyu-conversation-tools');
    assert.ok(!tools.open);
    assert.ok(!f.all(composer).some(e => e.className === 'gd-muyu-context'));
    assert.ok(f.all(tools).some(e => e.className === 'gd-muyu-context'));
    await f.all().find(e => e.className?.includes('gd-muyu-permission-summary')).click();
    assert.equal(data.hidden, false); assert.equal(connection.hidden, true);
    await f.find('button', en ? 'Budgets' : '运行预算').click();
    assert.equal(limits.hidden, false); assert.equal(data.hidden, true);
    assert.equal(f.find('button', en ? 'Budgets' : '运行预算').getAttribute('aria-current'), 'page');
    await f.find('button', en ? 'Back to chat' : '返回聊天').click();
    await f.find('button', '⚙').click();
    assert.equal(limits.hidden, false); // Keep the last settings category.
    f.emit(); assert.equal(endpoint.value, 'https://draft.invalid'); assert.equal(budget.value, '7');
    await f.find('button', en ? 'Back to chat' : '返回聊天').click();
    await f.find('button', en ? 'Configure connection' : '配置连接').click();
    assert.equal(connection.hidden, false); assert.equal(limits.hidden, true);
    const setup = f.find('button', en ? 'Configure connection' : '配置连接');
    assert.equal(setup.parent.className, 'gd-muyu-connection-entry');
    assert.equal(setup.parent.parent.className, 'gd-muyu-chat');
    assert.equal(setup.parent.hidden, false);
    f.state.enabled = true; f.emit(); assert.equal(setup.parent.hidden, true);
    f.state.enabled = false; f.emit(); assert.equal(setup.parent.hidden, false);
    assert.equal(f.sent.length, 0); assert.equal(f.configs.length, 0);
    f.root.__gdMuyuDispose(); assert.equal(f.listeners.size, 0);
});
test('Behavior editor keeps drafts through remount, rejects over-limit saves and requires saving restored defaults', async () => {
    const f = fixture('en', true); const defaults = { enabled: false, text: '' };
    f.state.instructionSettings = { saved: { ...defaults }, draft: { ...defaults }, dirty: false, saving: false };
    f.controller.setInstructionDraft = value => { f.state.instructionSettings.draft = value; f.state.instructionSettings.dirty = true; f.emit(); };
    f.controller.saveInstructions = () => { const s = f.state.instructionSettings; s.saved = { ...s.draft }; s.dirty = false; f.emit(); };
    f.controller.resetInstructionDraft = () => f.controller.setInstructionDraft({ ...defaults });
    const editor = () => f.all().find(e => e.tag === 'textarea' && e.parent.textContent === 'Additional instructions');
    f.emit(); editor().value = '<img>literal preference</img>'; await editor().oninput();
    const toggle = f.all().find(e => e.type === 'checkbox' && e.parent.textContent === 'Enable additional instructions (off by default)'); toggle.checked = true; await toggle.onchange();
    f.state.viewToken++; f.emit(); f.root.__gdMuyuDispose(); f.mount(); assert.equal(editor().value, '<img>literal preference</img>'); assert.equal(f.find('img'), undefined);
    await f.find('button', 'Save behavior preferences').click(); assert.equal(f.state.instructionSettings.saved.enabled, true);
    editor().value = 'a'.repeat(4001); await editor().oninput(); assert.equal(f.find('button', 'Save behavior preferences').disabled, true); assert.equal(editor().value.length, 4001);
    await f.find('button', 'Restore defaults (save required)').click(); assert.equal(editor().value, ''); assert.equal(f.state.instructionSettings.saved.enabled, true);
    await f.find('button', 'Save behavior preferences').click(); assert.equal(f.state.instructionSettings.saved.enabled, false); assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});
test('Context UI preserves settings drafts, requires summary confirmation and resets it on view change', async () => {
    const f = fixture('en', true); f.state.enabled = true; f.state.history = managedHistory();
    f.state.context = { turns: 2, omitted: 4, summary: '<img>literal</img>', summaryUsed: true }; f.emit();
    const input = f.all().find(e => e.type === 'number' && e.parent.textContent === 'Input budget (estimated tokens)');
    input.value = '64000'; f.emit(); assert.equal(input.value, '64000');
    let calls = 0, omitted = false; f.controller.compactHistory = () => { calls++; }; f.controller.setOmitHistory = value => { omitted = value; };
    await f.find('button', 'Summarize history now').click(); assert.equal(calls, 0);
    f.state.viewToken++; f.emit(); assert.equal(f.find('button', 'Confirm model summarization').hidden, true);
    await f.find('button', 'Summarize history now').click(); await f.find('button', 'Confirm model summarization').click(); assert.equal(calls, 1);
    const omit = f.all().find(e => e.type === 'checkbox' && e.parent.textContent === 'Omit history this send (does not revoke tool access)'); omit.checked = true; await omit.onchange(); assert.equal(omitted, true);
    assert.equal(f.find('img'), undefined); f.state.readOnly = true; f.emit(); assert.equal(f.find('button', 'Summarize history now').disabled, true);
    f.root.__gdMuyuDispose();
});
test('History navigation owns creation/import; narrow selection and creation close the sidebar', async () => {
    const f = fixture('en', true); f.state.history = managedHistory(); f.emit();
    const sidebar = f.find('aside'), settings = f.all().find(e => e.className === 'gd-muyu-settings');
    assert.equal(f.find('button', 'New conversation').parent, sidebar);
    assert.ok(f.all(sidebar).some(e => e.type === 'file'));
    assert.ok(!f.all(settings).some(e => e.type === 'file' || e.textContent === 'Export current conversation JSON'));
    const filters = f.all().find(e => e.className === 'gd-muyu-history-filters');
    assert.ok(!filters.open); assert.equal(f.all(filters).filter(e => e.tag === 'select').length, 3);
    await f.find('button', 'History').click(); assert.equal(sidebar.hidden, false);
    await f.find('button', 'Title').click(); assert.equal(sidebar.hidden, true);
    await f.find('button', 'History').click(); await f.find('button', 'New conversation').click();
    assert.equal(sidebar.hidden, true); assert.equal(f.state.history.sessionId, 'new');
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('Row export targets its own conversation and ignores selection changes during an awaited open', async () => {
    const f = fixture('en', true); f.state.history = managedHistory(); f.emit(); const exports = [];
    f.controller.exportHistory = format => { exports.push([f.state.history.sessionId, format]); return '{}'; };
    f.state.history.sessionId = 'another';
    await f.find('button', 'Export JSON').click(); assert.deepEqual(exports, [['old', 'json']]);
    f.controller.openSession = async () => { f.state.history.sessionId = 'another'; };
    await f.find('button', 'Export Markdown').click(); assert.equal(exports.length, 1);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('Sidebar responds to container width, preserves manual choice and traps only visible controls', t => {
    const previous = globalThis.ResizeObserver; let resize, disconnected = 0;
    globalThis.ResizeObserver = class { constructor(callback) { resize = callback; } observe() {} disconnect() { disconnected++; } };
    t.after(() => { if (previous) globalThis.ResizeObserver = previous; else delete globalThis.ResizeObserver; });
    const f = fixture('en', true); f.state.history = managedHistory(); f.emit();
    const sidebar = f.all().find(e => e.tag === 'aside'), toggle = f.find('button', 'History');
    resize([{ contentRect: { width: 800 } }]); assert.equal(sidebar.hidden, false);
    f.find('button', 'Close history').click(); resize([{ contentRect: { width: 900 } }]); assert.equal(sidebar.hidden, true);
    toggle.click(); resize([{ contentRect: { width: 400 } }]); assert.equal(sidebar.hidden, false);
    const first = f.all(sidebar).find(e => e.tag === 'button' && e.textContent === 'Back to chat'), last = f.find('button', 'Title'), hidden = f.find('button', 'Delete');
    hidden.getClientRects = () => []; sidebar.querySelectorAll = () => [first, last, hidden];
    let prevented = 0; sidebar.onkeydown({ key: 'Tab', target: last, shiftKey: false, preventDefault() { prevented++; } });
    assert.equal(first.ownerDocument.activeElement, first); assert.equal(prevented, 1);
    sidebar.onkeydown({ key: 'Escape', stopPropagation() {}, preventDefault() {} }); assert.equal(sidebar.hidden, true); assert.equal(toggle.attrs['aria-expanded'], 'false');
    f.root.__gdMuyuDispose(); assert.equal(disconnected, 1); assert.equal(f.sent.length, 0);
});
test('Sidebar filters are explicit and metadata/delete actions require confirmation', async () => {
    const f = fixture('zh', true); f.state.history = managedHistory(); f.emit();
    const search = f.all().find(e => e.type === 'search'); search.value = 'title'; await search.oninput(); assert.equal(f.state.history.filters.query, 'title');
    await f.find('button', '重命名').click(); assert.equal(f.state.history.selected.title, 'Title');
    const title = f.all().find(e => e.tag === 'input' && e.parent.textContent === '对话标题'); title.value = 'New title';
    await f.find('button', '确认').click(); assert.equal(f.state.history.selected.title, 'New title');
    await f.find('button', '删除').click(); assert.equal(f.state.history.sessionId, 'old');
    const warning = f.all().find(e => e.tag === 'p' && e.textContent?.includes('已保存的这条记录'));
    assert.ok(warning); await f.find('button', '取消').click(); assert.equal(f.state.history.sessionId, 'old');
    await f.find('button', '删除').click(); await f.find('button', '确认').click(); assert.equal(f.state.history.sessionId, ''); assert.equal(f.sent.length, 0);
    f.root.__gdMuyuDispose();
});

test('Read-only historical view disables sending and cannot stop another live task', () => {
    const f = fixture('en', true); f.state.history = managedHistory(); f.state.readOnly = true; f.state.enabled = true; f.state.busy = true; f.emit();
    assert.equal(f.find('textarea').disabled, true); assert.equal(f.find('button', 'Send').disabled, true);
    assert.equal(f.find('button', 'Stop').disabled, true); assert.equal(f.find('button', 'Stop').hidden, true);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('Choosing an import file only previews it; explicit confirmation imports once', async () => {
    const f = fixture('zh', true); f.state.history = managedHistory(); f.emit(); let imports = 0;
    f.controller.previewHistoryImport = importPreview; f.controller.importHistory = async () => { imports++; };
    const file = f.all().find(e => e.type === 'file'), text = JSON.stringify({ version: 1, id: crypto.randomUUID(), revision: 0, scope: JSON.stringify(['chat', 'chat', 'A']), title: '<script>literal</script>', createdAt: 1, updatedAt: 1, messages: [], required: [], status: 'idle' });
    file.files = [{ size: text.length, text: async () => text }];
    Object.defineProperty(file, 'value', { configurable: true, get: () => '', set() { file.files = []; } });
    await file.onchange(); assert.equal(imports, 0); assert.equal(f.find('button', '确认导入只读备份').disabled, false);
    assert.equal(f.find('script'), undefined); await f.find('button', '确认导入只读备份').click(); await f.find('button', '确认导入只读备份').click();
    assert.equal(imports, 1); assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('View switches restore scroll position and unrelated renders do not force scrolling', () => {
    const f = fixture('en', true), saved = [];
    f.controller.setScrollPosition = (key, top) => saved.push([key, top]); f.state.viewKey = 'A'; f.state.scrollTop = 40; f.emit();
    const transcript = f.all().find(e => e.className === 'gd-muyu-transcript'); transcript.scrollHeight = 500; transcript.clientHeight = 100; transcript.scrollTop = 350;
    f.state.viewKey = 'B'; f.state.viewToken++; f.state.scrollTop = 25; f.emit(); assert.equal(transcript.scrollTop, 25); assert.deepEqual(saved.at(-1), ['A', 350]);
    transcript.scrollTop = 350; f.emit(); assert.equal(transcript.scrollTop, 350); f.root.__gdMuyuDispose();
});

test('Session chooser creates/switches explicitly and saving remains opt-in without model calls', async () => {
    const f = fixture('zh', true);
    f.state.history = { available: true, enabled: false, loading: false, pending: 0, error: null, dirty: false, sessionId: '', sessions: [{ id: 'old', title: '<img onerror=alert(1)>' }], missingPermissions: [], omitted: 0 };
    f.emit(); assert.equal(f.sent.length, 0);
    const open = f.find('button', '<img onerror=alert(1)>');
    assert.equal(open.textContent, '<img onerror=alert(1)>'); assert.equal(f.find('img'), undefined);
    await open.click(); assert.equal(f.state.history.sessionId, 'old');
    await f.find('button', '新对话').click(); assert.equal(f.state.history.sessionId, 'new');
    const save = f.all().find(e => e.type === 'checkbox' && e.parent.textContent === '保存历史到本浏览器（默认关闭）');
    assert.equal(save.checked, false); save.checked = true; await save.onchange(); assert.equal(f.state.history.enabled, true);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('History status distinguishes loading, conflicts, permission gates and interrupted tasks', () => {
    const f = fixture('en', true); f.state.enabled = true;
    f.state.history = { available: true, enabled: true, loading: true, pending: 0, error: null, sessionId: 'old', sessions: [], missingPermissions: [], omitted: 0 }; f.emit();
    assert.equal(f.find('button', 'Send').disabled, true);
    f.state.history.loading = false; f.state.history.error = 'HISTORY_CONFLICT'; f.state.history.restoredStatus = 'interrupted'; f.state.history.missingPermissions = ['chat']; f.emit();
    const status = f.all().find(e => e.tag === 'small' && e.attrs.role === 'status');
    assert.match(status.textContent, /Another tab/); assert.match(status.textContent, /interrupted/); assert.match(status.textContent, /Reauthorize/);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('Classic view defaults closed and disabled; mount/close/rebuild never starts work or leaks subscriptions', () => {
    const f = fixture(); const shell = f.find('details');
    assert.equal(f.listeners.size, 0); assert.equal(f.find('button', '发送').disabled, true);
    shell.toggle(true); shell.toggle(true); assert.equal(f.listeners.size, 1);
    f.find('textarea').value = 'unsaved'; f.find('textarea').oninput();
    shell.toggle(false); assert.equal(f.listeners.size, 0);
    f.mount(); assert.equal(f.root.children.length, 1); assert.equal(f.find('textarea').value, 'unsaved');
    f.find('details').toggle(true); assert.equal(f.listeners.size, 1);
    f.root.__gdMuyuDispose(); shell.toggle(true); assert.equal(f.listeners.size, 0); assert.equal(f.sent.length, 0);
});

test('Panel clears key after configure; each click/keyboard send runs once and requires fresh consent', async () => {
    const f = fixture(); f.find('details').toggle(true);
    const key = f.all().find(e => e.type === 'password'); key.value = 'synthetic';
    await f.find('button', '启用此连接').click(); assert.equal(key.value, ''); assert.equal(f.configs[0].thinking, true);
    await f.find('button', '发送').click(); assert.equal(f.sent.length, 0);
    const consent = f.all().find(e => e.type === 'checkbox' && e.parent.className === 'gd-muyu-consent');
    consent.checked = true; f.find('textarea').value = 'question';
    f.find('textarea').onkeydown({ ctrlKey: true, key: 'Enter', preventDefault() {} });
    assert.equal(f.sent.length, 0);
    await f.find('button', '确认发送').click();
    assert.equal(f.sent.length, 1); assert.equal(consent.checked, false); assert.equal(f.find('button', '发送').disabled, true);
    await f.find('button', '停止').click(); assert.equal(f.stops(), 1);
    consent.checked = true; f.state.viewToken++; f.emit(); assert.equal(consent.checked, false);
    key.value = 'unsent'; f.find('details').toggle(false); assert.equal(key.value, '');
});

test('Model/user text is rendered as text; English labels and no apply control', () => {
    const f = fixture('en'); f.find('details').toggle(true);
    f.state.messages = [{ role: 'assistant', content: '<img src=x onerror=alert(1)>' }]; f.emit();
    assert.equal(f.find('span').textContent, '<img src=x onerror=alert(1)>');
    assert.equal(f.find('img'), undefined); assert.ok(f.find('button', 'Send'));
    assert.ok(f.all().every(e => e.innerHTML === undefined)); assert.equal(f.find('button', 'Apply'), undefined);
});

test('Standalone view subscribes immediately; reopening restores input but never retains authorization', () => {
    const f = fixture('zh', true); assert.equal(f.listeners.size, 1);
    f.find('textarea').value = 'draft across windows'; f.find('textarea').oninput();
    f.all().find(e => e.type === 'checkbox' && e.parent.className === 'gd-muyu-consent').checked = true;
    f.root.__gdMuyuDispose(); assert.equal(f.listeners.size, 0);
    f.mount(); assert.equal(f.listeners.size, 1); assert.equal(f.find('textarea').value, 'draft across windows');
    assert.equal(f.all().find(e => e.type === 'checkbox' && e.parent.className === 'gd-muyu-consent').checked, false);
    assert.equal(f.sent.length, 0); f.root.__gdMuyuDispose();
});

test('Settings are hidden initially; gear/back preserve draft input and clear unsent credentials', async () => {
    const f = fixture('zh', true), settings = f.all().find(e => e.className === 'gd-muyu-settings'), chat = f.all().find(e => e.className === 'gd-muyu-chat');
    assert.equal(settings.hidden, true);
    assert.equal(f.find('button', '配置连接').hidden, false);
    f.find('textarea').value = 'keep this draft'; f.find('textarea').oninput();
    await f.find('button', '配置连接').click(); assert.equal(settings.hidden, false); assert.equal(chat.hidden, true);
    const key = f.all().find(e => e.type === 'password'); key.value = 'unsent secret';
    await f.find('button', '返回聊天').click(); assert.equal(settings.hidden, true); assert.equal(key.value, '');
    assert.equal(f.find('textarea').value, 'keep this draft'); assert.equal(f.sent.length, 0);
    const gear = f.all().find(e => e.attrs['aria-label'] === '暮羽配置'); await gear.click(); assert.equal(settings.hidden, false);
    await f.find('button', '启用此连接').click(); assert.equal(settings.hidden, true); assert.equal(chat.hidden, false);
    assert.equal(f.find('button', '配置连接').hidden, true); f.root.__gdMuyuDispose();
});

test('Send opens authorization without a model call; settings/target changes revoke confirmation', async () => {
    const f = fixture('zh', true); await f.find('button', '启用此连接').click();
    const auth = f.all().find(e => e.className === 'gd-muyu-authorization');
    const consent = f.all().find(e => e.type === 'checkbox' && e.parent.className === 'gd-muyu-consent');
    f.find('textarea').value = 'diagnose'; await f.find('button', '发送').click();
    assert.equal(auth.hidden, false); assert.equal(f.sent.length, 0);
    await f.find('button', '确认发送').click(); assert.equal(f.sent.length, 0);
    consent.checked = true; await f.find('button', '返回编辑').click(); assert.equal(auth.hidden, true); assert.equal(consent.checked, false);
    await f.find('button', '发送').click(); consent.checked = true;
    await f.all().find(e => e.attrs['aria-label'] === '暮羽配置').click(); assert.equal(auth.hidden, true); assert.equal(consent.checked, false);
    await f.find('button', '返回聊天').click(); await f.find('button', '发送').click(); consent.checked = true;
    f.state.viewToken++; f.emit(); assert.equal(auth.hidden, true); assert.equal(consent.checked, false); f.root.__gdMuyuDispose();
});

test('Task selector reveals field scope only for a draft request; messages have distinct bubble roles', async () => {
    const f = fixture('en', true); await f.find('button', 'Enable connection').click();
    const mode = f.all().find(e => e.tag === 'select' && e.parent.textContent === 'Task'); mode.value = 'draft'; await mode.onchange();
    assert.equal(f.find('fieldset').hidden, false);
    f.state.messages = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }]; f.emit();
    assert.equal(f.all().filter(e => e.className === 'gd-muyu-message gd-muyu-user').length, 1);
    assert.equal(f.all().filter(e => e.className === 'gd-muyu-message gd-muyu-assistant').length, 1);
    mode.value = 'memory'; await mode.onchange(); assert.equal(f.find('fieldset').hidden, true); f.root.__gdMuyuDispose();
});

test('Process details stay collapsed by default and preserve expansion/scroll while progress updates', () => {
    const f = fixture('zh', true);
    const process = { phase: 'model.started', terminal: null, cleaned: false, rows: [], toolFailures: 0, dropped: 0, error: null };
    f.state.runs = [{ id: 'r1', process }]; f.state.messages = [{ role: 'user', runId: 'r1', content: 'test' }]; f.emit();
    const details = f.all().find(e => e.className === 'gd-muyu-process'); assert.ok(details); assert.ok(!details.open);
    details.open = true;
    const list = details.children.find(e => e.tag === 'ol'); list.scrollTop = 25;
    process.rows.push({ type: 'tool.started', attemptId: 1, tool: 'muyu.memory.inspect', durationMs: null, error: null });
    process.phase = 'tool.started'; f.emit();
    assert.equal(f.all().find(e => e.className === 'gd-muyu-process'), details); assert.equal(details.open, true); assert.equal(list.scrollTop, 25);
    process.terminal = 'cancelled'; process.phase = 'cancelled'; f.emit();
    assert.match(details.children[0].textContent, /等待上游清理/);
    process.cleaned = true; f.emit(); assert.doesNotMatch(details.children[0].textContent, /等待上游清理/);
    f.state.viewToken++; f.state.runs = []; f.state.messages = []; f.emit(); assert.equal(f.all().find(e => e.className === 'gd-muyu-process'), undefined);
    f.root.__gdMuyuDispose();
});

test('Director selection changes permission wording and requires a current chat', async () => {
    const f = fixture('zh', true); await f.find('button', '启用此连接').click();
    const mode = f.all().find(e => e.tag === 'select' && e.parent.textContent === '任务');
    mode.value = 'director'; await mode.onchange();
    const label = f.all().find(e => e.className === 'gd-muyu-consent');
    assert.match(label.children.find(e => e.tag === 'span').textContent, /导演白名单/);
    assert.match(label.children.find(e => e.tag === 'span').textContent, /不含角色身份/);
    f.state.hasChat = false; f.emit(); assert.equal(f.find('button', '发送').disabled, true); f.root.__gdMuyuDispose();
});

test('Saved permission sends directly once, survives view remount and can be revoked from settings', async () => {
    const f = fixture('zh', true); f.state.enabled = true; f.state.permissions = { diagnostics: true, chat: false }; f.emit();
    f.find('textarea').value = 'no repeated checkbox'; await f.find('button', '发送').click();
    assert.equal(f.sent.length, 1); assert.equal(f.all().find(e => e.className === 'gd-muyu-authorization').hidden, true);
    f.state.busy = false; f.mount(); f.find('textarea').value = 'again'; await f.find('button', '发送').click(); assert.equal(f.sent.length, 2);
    const checkbox = f.all().find(e => e.type === 'checkbox' && e.parent.textContent?.startsWith('插件诊断信息'));
    checkbox.checked = false; await checkbox.onchange(); assert.equal(f.state.permissions.diagnostics, false);
});

test('Remember-key option is opt-in; saved key is not placed in password input and forget clears status', async () => {
    const f = fixture('zh', true), remember = f.all().find(e => e.type === 'checkbox' && e.parent.textContent?.startsWith('记住 API'));
    assert.equal(remember.checked, false); remember.checked = true;
    f.all().find(e => e.type === 'password').value = 'SYNTHETIC'; await f.find('button', '启用此连接').click();
    assert.equal(f.configs[0].rememberKey, true); assert.equal(f.all().find(e => e.type === 'password').value, '');
    f.state.savedConnection = { remembered: true, endpoint: 'https://saved.test/chat/completions', model: 'saved', thinking: true }; f.mount();
    assert.equal(f.all().find(e => e.type === 'password').value, ''); assert.equal(f.all().find(e => e.type === 'url').value, 'https://saved.test/chat/completions');
    await f.find('button', '清除已保存密钥').click(); assert.equal(f.state.savedConnection, null);
});

test('Extended story context has its own opt-in control and scope summary', async () => {
    const f = fixture('zh', true); f.state.enabled = true; f.state.permissions = { chat: true, extended: false }; f.emit();
    const extended = f.all().find(e => e.type === 'checkbox' && e.parent.textContent?.startsWith('扩展剧情上下文'));
    assert.equal(extended.checked, false); extended.checked = true; await extended.onchange();
    assert.equal(f.state.permissions.extended, true); assert.match(f.all().find(e => e.className?.includes('gd-muyu-permission-summary')).textContent, /扩展剧情上下文/);
    f.state.hasChat = false; f.emit(); assert.equal(extended.disabled, true);
});

test('Execution budget controls save units and preserve edits across progress renders', async () => {
    const f = fixture('zh', true);
    const modelCalls = f.all().find(e => e.type === 'number' && e.parent.textContent === '模型调用次数');
    const timeout = f.all().find(e => e.type === 'number' && e.parent.textContent === '单轮超时（秒）');
    assert.equal(modelCalls.value, '6'); assert.equal(timeout.value, '120');
    modelCalls.value = '10'; timeout.value = '60'; f.emit(); assert.equal(modelCalls.value, '10');
    await f.find('button', '保存运行预算').click(); assert.equal(f.state.runConfig.modelCalls, 10); assert.equal(f.state.runConfig.timeMs, 60000);
    await f.find('button', '恢复默认预算并保存').click(); assert.equal(modelCalls.value, '6'); assert.equal(timeout.value, '120');
    modelCalls.value = '1.5'; await f.find('button', '保存运行预算').click(); assert.equal(f.state.runConfig.modelCalls, 6);
});
