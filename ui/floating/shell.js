import { visibleViewport, isMobileViewport, validBallPosition, dockedBallRect } from './geometry.js';

/** Keep draggable surfaces within the visible viewport, including after orientation changes. */
export function fitFloatingRect(rect, viewport) {
    const width = Math.min(Math.max(rect.width, 48), Math.max(48, viewport.width - 16));
    const height = Math.min(Math.max(rect.height, 48), Math.max(48, viewport.height - 16));
    const x = viewport.x || 0, y = viewport.y || 0;
    return { width, height, x: x + Math.max(8, Math.min(rect.x - x, viewport.width - width - 8)), y: y + Math.max(8, Math.min(rect.y - y, viewport.height - height - 8)) };
}

/** Reserve a left rail without shrinking the conversation; small viewports use a separate page. */
export function fitSidebarRect(rect, viewport, opened) {
    const base = fitFloatingRect(rect, viewport);
    const extra = opened && base.width >= 460 && base.width + 240 <= viewport.width - 16 ? 240 : 0;
    return { rect: fitFloatingRect({ ...base, x: base.x - extra, width: base.width + extra }, viewport), extra };
}

/** Generic single-window shell. Closing a view never stops its module's business work. */
export function createFloatingShell({ registry, doc = document, win = window, lang = 'zh', getBallPosition = () => null, saveBallPosition = () => {} }) {
    let language = lang, activeId = null, teardown = null, disposed = false, returnFocus = null, sidebarOpen = false, mountVersion = 0;
    let ballVisible = true;
    const t = (zh, en) => language === 'en' ? en : zh;
    const node = (tag, parent, cls) => { const e = doc.createElement(tag); if (cls) e.className = cls; parent.append(e); return e; };
    const root = node('div', doc.body, 'gd-floating-root');
    const button = (parent, cls) => { const e = node('button', parent, cls); e.type = 'button'; return e; };
    const ball = button(root, 'gd-floating-ball');
    const menu = node('div', root, 'gd-floating-menu'); menu.hidden = true;
    const frame = node('section', root, 'gd-floating-window'); frame.hidden = true; frame.tabIndex = -1;
    frame.setAttribute('role', 'dialog'); frame.setAttribute('aria-modal', 'false');
    const header = node('header', frame, 'gd-floating-header');
    const title = node('strong', header), actions = node('div', header, 'gd-floating-header-actions'), closeButton = button(header);
    const content = node('div', frame, 'gd-floating-content');
    const viewport = () => {
        const css = win.getComputedStyle?.(root);
        return visibleViewport(win, { left: parseFloat(css?.paddingLeft), right: parseFloat(css?.paddingRight), top: parseFloat(css?.paddingTop), bottom: parseFloat(css?.paddingBottom) });
    };
    let ballPosition;
    try { ballPosition = validBallPosition(getBallPosition()); } catch { ballPosition = validBallPosition(null); }
    let ballDragging = false;
    let bounds = fitFloatingRect({ x: win.innerWidth - 540, y: 70, width: 520, height: 660 }, viewport());
    let ballBounds = dockedBallRect(ballPosition, viewport());
    function paint(el, rect) { Object.assign(el.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' }); }
    function layout() {
        const area = viewport(), mobile = isMobileViewport(win);
        root.dataset.mobile = String(mobile);
        // Mobile geometry is temporary: keyboard/orientation changes cannot shrink desktop bounds.
        const expanded = mobile ? { extra: 0, rect: { x: area.x + 8, y: area.y + 8, width: Math.max(1, area.width - 16), height: Math.max(1, area.height - 16) } }
            : fitSidebarRect(bounds, area, sidebarOpen);
        ballBounds = !ballDragging && mobile ? dockedBallRect(ballPosition, area, !activeId && menu.hidden) : fitFloatingRect(ballBounds, area);
        ball.hidden = !ballVisible || !registry.list().some(e => e.available) || (mobile && !!activeId);
        frame.style.minWidth = expanded.extra ? 'min(700px, calc(100vw - 16px))' : '';
        paint(frame, expanded.rect); paint(ball, ballBounds);
        menu.style.left = mobile ? area.x + 8 + 'px' : ''; menu.style.top = mobile ? area.y + 8 + 'px' : '';
        menu.style.right = mobile ? '' : win.innerWidth - area.x - area.width + 8 + 'px';
        menu.style.bottom = mobile ? '' : win.innerHeight - area.y - area.height + 72 + 'px';
        menu.style.maxWidth = Math.max(1, area.width - 16) + 'px'; menu.style.maxHeight = Math.max(1, area.height - 16) + 'px';
    }
    function close() {
        if (!activeId) { menu.hidden = true; render(); return; }
        const cleanup = teardown; teardown = null; activeId = null; sidebarOpen = false; mountVersion++; frame.hidden = true; menu.hidden = true;
        try { cleanup?.(); } finally { content.replaceChildren(); actions.replaceChildren(); layout(); render(); (returnFocus?.isConnected ? returnFocus : ball).focus(); }
    }
    function open(id) {
        if (disposed) return;
        const entry = registry.list().find(e => e.id === id && e.available); if (!entry) return;
        menu.hidden = true;
        if (activeId === id) { frame.focus(); return; }
        if (activeId) close();
        returnFocus = doc.activeElement; activeId = id; frame.hidden = false;
        const version = ++mountVersion;
        try { teardown = registry.mount(id, content, { lang: language, close, actionsRoot: actions,
            setSidebarOpen: value => {
                if (disposed || version !== mountVersion || activeId !== id || sidebarOpen === !!value) return;
                sidebarOpen = !!value; layout();
            }, resetLayout: () => {
            bounds = fitFloatingRect({ x: win.innerWidth - 540, y: 70, width: 520, height: 660 }, viewport()); layout();
        } }); }
        catch { content.replaceChildren(); node('p', content).textContent = t('面板未能打开，请关闭后重试。', 'Could not open panel. Close and retry.'); }
        layout(); render(); frame.focus();
    }
    function render() {
        if (disposed) return;
        const entries = registry.list().filter(e => e.available), current = entries.find(e => e.id === activeId);
        if (activeId && !current) { close(); return; }
        const labels = { idle: t('空闲', 'Idle'), running: t('运行中', 'Running'), attention: t('需关注', 'Attention'), error: t('错误', 'Error') };
        ball.textContent = 'GD'; ball.dataset.status = registry.status(); ball.hidden = !ballVisible || !entries.length || (isMobileViewport(win) && !!activeId);
        ball.setAttribute('aria-label', t('插件快捷入口', 'Plugin shortcuts') + ' · ' + labels[registry.status()]);
        ball.title = t('点击展开或收回，拖动移动；方向键调整位置', 'Click to expand or collapse, drag to move; arrow keys reposition');
        ball.setAttribute('aria-expanded', String(!menu.hidden || !!activeId));
        title.textContent = current ? current.label[language === 'en' ? 'en' : 'zh'] + ' · ' + labels[current.status] : '';
        frame.setAttribute('aria-label', title.textContent);
        closeButton.textContent = '−'; closeButton.setAttribute('aria-label', t('收起窗口', 'Collapse window')); closeButton.title = t('收起窗口', 'Collapse window');
        const focusedEntry = menu.children.length && [...menu.children].find(b => b === doc.activeElement)?.dataset.entry;
        menu.replaceChildren();
        for (const entry of entries) {
            const b = button(menu); b.textContent = entry.icon + ' ' + entry.label[language === 'en' ? 'en' : 'zh'] + ' · ' + labels[entry.status];
            b.dataset.entry = entry.id;
            b.onclick = () => open(entry.id);
            if (!menu.hidden && focusedEntry === entry.id) b.focus();
        }
    }
    ball.onclick = () => {
        if (ball.__gdDragged) { ball.__gdDragged = false; return; }
        if (activeId) { close(); return; }
        const entries = registry.list().filter(e => e.available);
        if (entries.length === 1) open(entries[0].id);
        else { menu.hidden = !menu.hidden; layout(); render(); if (!menu.hidden) menu.firstElementChild?.focus(); }
    };
    closeButton.onclick = close;
    frame.onkeydown = menu.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); ball.focus(); } };
    const dragCleanups = [];
    function rememberBall() {
        const area = viewport();
        ballPosition = validBallPosition({ side: ballBounds.x + 24 < area.x + area.width / 2 ? 'left' : 'right',
            fraction: Math.max(0, Math.min(1, (ballBounds.y - area.y - 8) / Math.max(1, area.height - 64))) });
        try { Promise.resolve(saveBallPosition({ ...ballPosition })).catch(() => {}); } catch { /* Position saving cannot fail a view. */ }
    }
    function draggable(handle, element, read, write, enabled = () => true) {
        let drag = null;
        const end = () => { if (drag) { try { handle.releasePointerCapture?.(drag.id); } catch { /* Already released. */ }
            if (element === ball) { if (element.__gdDragged) rememberBall(); ballDragging = false; }
            drag = null; layout(); } };
        handle.onpointerdown = e => {
            if (!enabled() || e.button !== 0 || e.target.closest('button') && e.target.closest('button') !== handle) return;
            element.__gdDragged = false; drag = { id: e.pointerId, x: e.clientX, y: e.clientY, initial: { ...read() } };
            if (element === ball) ballDragging = true;
            handle.setPointerCapture?.(e.pointerId);
        };
        handle.onpointermove = e => {
            if (!drag || e.pointerId !== drag.id) return;
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            if (Math.abs(dx) + Math.abs(dy) < 5 && !element.__gdDragged) return;
            element.__gdDragged = true; write(fitFloatingRect({ ...drag.initial, x: drag.initial.x + dx, y: drag.initial.y + dy }, viewport())); layout();
        };
        handle.onpointerup = handle.onpointercancel = end;
        dragCleanups.push(end);
    }
    draggable(ball, ball, () => ballBounds, r => { ballBounds = r; });
    draggable(header, frame, () => fitSidebarRect(bounds, viewport(), sidebarOpen).rect, r => {
        const extra = fitSidebarRect(bounds, viewport(), sidebarOpen).extra;
        bounds = { ...r, x: r.x + extra, width: r.width - extra };
    }, () => !isMobileViewport(win));
    ball.onkeydown = e => {
        const delta = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
        if (!delta) return; e.preventDefault(); ballBounds = fitFloatingRect({ ...ballBounds, x: ballBounds.x + delta[0], y: ballBounds.y + delta[1] }, viewport()); rememberBall(); layout();
    };
    const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(() => {
        if (frame.hidden || isMobileViewport(win)) return;
        const rect = frame.getBoundingClientRect();
        const expected = fitSidebarRect(bounds, viewport(), sidebarOpen);
        if (Math.abs(rect.width - expected.rect.width) < 1 && Math.abs(rect.height - expected.rect.height) < 1) return;
        bounds = fitFloatingRect({ ...bounds, x: rect.left + expected.extra, width: Math.max(300, rect.width - expected.extra), height: rect.height }, viewport());
        layout();
    }) : null;
    observer?.observe(frame); win.addEventListener('resize', layout);
    win.visualViewport?.addEventListener('resize', layout); win.visualViewport?.addEventListener('scroll', layout);
    const unsubscribe = registry.subscribe(render); layout(); render();
    return Object.freeze({
        open, close,
        setBallVisible(value) {
            if (disposed) return;
            ballVisible = !!value;
            if (!ballVisible) menu.hidden = true;
            render();
        },
        setLanguage(value, { preserveActive = false } = {}) {
            if (value === language || disposed) return;
            if (preserveActive) { language = value; render(); return; }
            const id = activeId; if (id) close(); language = value; render(); if (id) open(id);
        },
        dispose() { if (disposed) return; close(); disposed = true; unsubscribe(); observer?.disconnect(); win.removeEventListener('resize', layout);
            win.visualViewport?.removeEventListener('resize', layout); win.visualViewport?.removeEventListener('scroll', layout); dragCleanups.forEach(fn => fn()); root.remove(); },
    });
}
