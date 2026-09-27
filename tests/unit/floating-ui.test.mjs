import test from 'node:test';
import assert from 'node:assert/strict';
import { createFloatingRegistry } from '../../ui/floating/registry.js';
import { createFloatingShell, fitFloatingRect, fitSidebarRect } from '../../ui/floating/shell.js';

const entry = (id, overrides = {}) => ({ id, label: { zh: id, en: id }, icon: '*', order: 10, mount: () => () => {}, ...overrides });
test('Floating registry supports independent modules, priority aggregation and isolated metadata', () => {
    const r = createFloatingRegistry(); let status = 'idle', notify, cleaned = 0;
    const remove = r.register(entry('chat', { getStatus: () => status, subscribe: fn => { notify = fn; return () => cleaned++; } }));
    r.register(entry('monitor', { order: 0, getStatus: () => 'error' }));
    r.register(entry('disabled', { isAvailable: () => false, getStatus: () => 'error' }));
    let events = 0; const off = r.subscribe(() => events++);
    status = 'running'; notify(); assert.equal(events, 1); assert.equal(r.status(), 'error');
    assert.equal(r.list()[0].id, 'monitor'); const a = r.list(); a[0].label.zh = 'tampered'; assert.equal(r.list()[0].label.zh, 'monitor');
    assert.throws(() => r.register(entry('chat')), /INVALID/); assert.throws(() => r.mount('disabled'), /UNAVAILABLE/);
    off(); r.dispose(); remove(); assert.equal(cleaned, 1); assert.throws(() => r.register(entry('later')), /DISPOSED/);
});
test('Module status failures are isolated; unknown status cannot leak payloads into launcher', () => {
    const r = createFloatingRegistry(); r.register(entry('odd', { getStatus: () => '<secret>' })); assert.equal(r.status(), 'idle');
    r.register(entry('broken', { getStatus: () => { throw Error('private'); } }));
    assert.doesNotMatch(JSON.stringify(r.list()), /private|secret/); r.dispose();
});
test('Window geometry stays reachable at 320/400/600/800px and after viewport shrink', () => {
    for (const width of [320, 400, 600, 800]) {
        const r = fitFloatingRect({ x: 9999, y: -200, width: 520, height: 660 }, { width, height: 500 });
        assert.ok(r.x >= 8 && r.y >= 8); assert.ok(r.x + r.width <= width - 8); assert.ok(r.y + r.height <= 492);
    }
});

class Element {
    constructor(tag, doc) { this.tag = tag; this.ownerDocument = doc; this.children = []; this.style = {}; this.dataset = {}; this.attrs = {}; this.isConnected = true; }
    append(...nodes) { for (const n of nodes) { this.children.push(n); n.parent = this; } }
    replaceChildren() { this.children = []; }
    setAttribute(k, v) { this.attrs[k] = v; }
    remove() { this.parent.children = this.parent.children.filter(e => e !== this); this.isConnected = false; }
    focus() { this.ownerDocument.activeElement = this; }
    get firstElementChild() { return this.children[0]; }
    closest(tag) { return this.tag === tag ? this : this.parent?.closest(tag); }
}
function surface(onMount = () => {}, windowOptions = {}) {
    const doc = { createElement: tag => new Element(tag, doc) }; doc.body = new Element('body', doc);
    const events = new Map(), win = { innerWidth: 1000, innerHeight: 800, addEventListener(k, fn) { events.set(k, fn); }, removeEventListener(k) { events.delete(k); } };
    Object.assign(win, windowOptions);
    const registry = createFloatingRegistry(); let mounts = 0, disposals = 0;
    registry.register(entry('chat', { mount: (root, options) => { mounts++; onMount(options); return () => disposals++; } }));
    const shell = createFloatingShell({ registry, doc, win });
    const all = (el = doc.body) => [el, ...el.children.flatMap(n => all(n))];
    const find = cls => all().find(e => e.className === cls);
    return { doc, win, events, registry, shell, find, mounts: () => mounts, disposals: () => disposals };
}
test('Single entry opens directly, repeated open focuses existing view; close tears down view only', () => {
    const f = surface(), ball = f.find('gd-floating-ball'); ball.focus(); ball.onclick(); f.shell.open('chat');
    assert.equal(f.mounts(), 1); assert.equal(f.find('gd-floating-window').hidden, false);
    f.shell.close(); assert.equal(f.disposals(), 1); assert.equal(f.doc.activeElement, ball);
    f.shell.open('chat'); assert.equal(f.mounts(), 2); f.shell.dispose(); f.shell.dispose();
    assert.equal(f.disposals(), 2); assert.equal(f.events.size, 0); assert.equal(f.doc.body.children.length, 0); f.registry.dispose();
});

test('Bubble toggles an active window closed and reopens without double-mounting', () => {
    const f = surface(), ball = f.find('gd-floating-ball');
    ball.onclick(); assert.equal(f.mounts(), 1); assert.equal(ball.attrs['aria-expanded'], 'true');
    ball.onclick(); assert.equal(f.disposals(), 1); assert.equal(ball.attrs['aria-expanded'], 'false');
    ball.onclick(); assert.equal(f.mounts(), 2); f.shell.dispose(); f.registry.dispose();
});
test('Additional module creates selector and unavailable/removed active module closes safely', () => {
    const f = surface(); let available = true, notify;
    const remove = f.registry.register(entry('monitor', { isAvailable: () => available, subscribe: fn => { notify = fn; return () => {}; } }));
    f.find('gd-floating-ball').onclick(); assert.equal(f.mounts(), 0); assert.equal(f.find('gd-floating-menu').hidden, false);
    f.shell.open('monitor'); available = false; notify(); assert.equal(f.find('gd-floating-window').hidden, true);
    available = true; notify(); f.shell.open('monitor'); remove(); assert.equal(f.find('gd-floating-window').hidden, true);
    f.shell.dispose(); f.registry.dispose();
});
test('Language remounts once; resize and dragging never create additional business views', () => {
    const f = surface(); f.shell.open('chat'); f.shell.setLanguage('zh'); assert.equal(f.mounts(), 1);
    f.shell.setLanguage('en'); assert.equal(f.mounts(), 2); assert.equal(f.disposals(), 1);
    f.win.innerWidth = 320; f.events.get('resize')(); assert.equal(f.find('gd-floating-window').style.width, '304px');
    const ball = f.find('gd-floating-ball');
    ball.onpointerdown({ button: 0, pointerId: 1, target: ball, clientX: 200, clientY: 200 });
    ball.onpointermove({ pointerId: 1, clientX: -1000, clientY: -1000 }); ball.onpointerup(); ball.onclick();
    assert.equal(ball.style.left, '8px'); assert.equal(f.mounts(), 2);
    f.shell.dispose(); f.registry.dispose();
});

test('History rail grows left without shrinking chat, stays in viewport and restores the base geometry', () => {
    const base = { x: 460, y: 70, width: 520, height: 660 };
    const expanded = fitSidebarRect(base, { width: 1000, height: 800 }, true);
    assert.equal(expanded.extra, 240); assert.equal(expanded.rect.x, 220); assert.equal(expanded.rect.width, 760);
    assert.equal(expanded.rect.x + expanded.rect.width, base.x + base.width);
    for (const width of [320, 400, 600, 800, 1000]) {
        const result = fitSidebarRect(base, { width, height: 800 }, true);
        assert.ok(result.rect.x >= 8); assert.ok(result.rect.x + result.rect.width <= width - 8);
        assert.equal(result.extra, width >= 800 ? 240 : 0);
    }
    assert.equal(fitSidebarRect({ ...base, width: 400 }, { width: 1000, height: 800 }, true).extra, 0);
    let port;
    const f = surface(options => { port = options; }); f.shell.open('chat');
    const frame = f.find('gd-floating-window');
    port.setSidebarOpen(true); port.setSidebarOpen(true); assert.equal(frame.style.width, '760px'); assert.equal(frame.style.left, '220px');
    port.setSidebarOpen(false); assert.equal(frame.style.width, '520px'); assert.equal(frame.style.left, '460px');
    port.setSidebarOpen(true);
    const header = f.find('gd-floating-header');
    header.onpointerdown({ button: 0, pointerId: 2, target: header, clientX: 230, clientY: 80 });
    header.onpointermove({ pointerId: 2, clientX: -1000, clientY: 80 }); header.onpointerup();
    assert.equal(frame.style.left, '8px'); assert.equal(frame.style.width, '760px');
    port.setSidebarOpen(false); assert.equal(frame.style.left, '248px'); assert.equal(frame.style.width, '520px');
    const oldPort = port; f.shell.close(); f.shell.open('chat'); oldPort.setSidebarOpen(true);
    assert.equal(frame.style.width, '520px'); assert.equal(f.mounts(), 2);
    port.setSidebarOpen(true); f.win.innerWidth = 400; f.events.get('resize')();
    assert.equal(frame.style.width, '384px'); assert.equal(frame.style.left, '8px');
    f.shell.dispose(); f.registry.dispose();
});

test('Resize notifications do not repeatedly add rail width; user resize retains the new chat width', () => {
    let port, resize, disconnected = false;
    const f = surface(options => { port = options; }, { ResizeObserver: class {
        constructor(callback) { resize = callback; }
        observe() {}
        disconnect() { disconnected = true; }
    } });
    f.shell.open('chat');
    const frame = f.find('gd-floating-window');
    frame.getBoundingClientRect = () => ({ left: parseFloat(frame.style.left), width: parseFloat(frame.style.width), height: parseFloat(frame.style.height) });
    port.setSidebarOpen(true); resize(); resize();
    assert.equal(frame.style.width, '760px');
    frame.style.width = '800px'; frame.style.height = '620px'; resize(); resize();
    assert.equal(frame.style.width, '800px'); assert.equal(frame.style.height, '620px');
    port.setSidebarOpen(false); resize(); assert.equal(frame.style.width, '560px');
    port.setSidebarOpen(true); resize(); assert.equal(frame.style.width, '800px');
    f.shell.dispose(); assert.equal(disconnected, true); f.registry.dispose();
});
