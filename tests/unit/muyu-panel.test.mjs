import test from 'node:test';
import assert from 'node:assert/strict';
import { mountMuyuPanel } from '../../muyu/ui/panel.js';

// Minimal native DOM contract; does not assert CSS geometry or browser layout.
class Element {
    constructor(tag, doc) { this.tag = tag; this.ownerDocument = doc; this.children = []; this.attrs = {}; this.events = {}; this.value = ''; this.checked = false; this.classList = { add() {} }; }
    append(el) { this.children.push(el); el.parent = this; }
    replaceChildren() { this.children = []; }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(k, fn) { this.events[k] = fn; }
    remove() { this.parent.children = this.parent.children.filter(e => e !== this); }
    get options() { return this.children.filter(e => e.tag === 'option'); }
    click() { if (!this.disabled) return this.onclick?.(); }
    toggle(open) { this.open = open; this.events.toggle?.(); }
}
function fixture(lang = 'zh') {
    const doc = { createElement: tag => new Element(tag, doc) }, root = doc.createElement('div');
    const state = { viewToken: 1, enabled: false, mode: 'memory', input: '', hasChat: true, messages: [], runs: [], artifacts: [] };
    const listeners = new Set(), sent = [], configs = []; let stops = 0;
    const emit = () => { for (const fn of listeners) fn(); };
    const controller = {
        snapshot: () => structuredClone(state), subscribe(fn) { listeners.add(fn); return { unsubscribe: () => listeners.delete(fn) }; },
        setMode(mode) { state.mode = mode; state.viewToken++; emit(); }, setInput(input) { state.input = input; },
        send(options) { if (!options.consent) throw new Error('CONSENT_REQUIRED'); sent.push(options); state.input = ''; state.busy = true; emit(); },
        configure(config) { configs.push(config); state.enabled = true; emit(); }, disable() { state.enabled = false; emit(); }, stop() { stops++; state.busy = false; emit(); },
    };
    const all = (el = root) => [el, ...el.children.flatMap(e => all(e))];
    const find = (tag, label) => all().find(e => e.tag === tag && (label === undefined || e.textContent === label));
    const mount = () => mountMuyuPanel(root, controller, { lang });
    mount(); return { root, state, listeners, sent, configs, emit, find, all, mount, stops: () => stops };
}

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
    const consent = f.all().find(e => e.type === 'checkbox' && e.parent.textContent.startsWith('本次允许发送'));
    consent.checked = true; f.find('textarea').value = 'question';
    f.find('textarea').onkeydown({ ctrlKey: true, key: 'Enter', preventDefault() {} });
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
