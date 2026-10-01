import { taskCatalog } from '../modules/catalog.js';
import { createHistoryActions } from './history-actions.js';

/** Responsive history browser. Viewing another chat never changes the execution target. */
export function createHistoryView({ doc, settings, chat, workspace, sidebarRoot, controller, act, lang, setSidebarOpen }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, parent) => { const el = doc.createElement(tag); el.textContent = text; parent.append(el); return el; };
    const button = (text, parent) => { const el = node('button', text, parent); el.type = 'button'; el.className = 'menu_button'; return el; };
    const select = (label, values, owner) => {
        const wrapper = node('label', label, owner), el = node('select', '', wrapper); el.className = 'text_pole';
        for (const [value, text] of values) { const option = node('option', text, el); option.value = value; }
        return el;
    };
    const section = node('section', '', settings); node('h3', t('对话历史', 'Conversation history'), section);
    const label = node('label', t('自动保存暮羽对话（默认开启）', 'Automatically save Muyu conversations (on by default)'), section);
    const enabled = node('input', '', label); enabled.type = 'checkbox';
    node('small', t('默认使用 ST 私有文件（需要服务端插件），不可用时使用浏览器 IndexedDB。不写入聊天存档或角色卡；浏览器记录不跨设备同步。刷新不恢复授权或执行。', 'By default, use private ST files when the server plugin is available; otherwise use browser IndexedDB. Chat saves/cards are unaffected. Browser records do not sync across devices; reload never restores grants or execution.'), section);
    const storageLabel = node('label', t('保存到酒馆账户设置（可选，无需附属插件）', 'Store in ST account settings (optional, no companion plugin)'), section);
    const accountStorage = node('input', '', storageLabel); accountStorage.type = 'checkbox';
    const storageNotice = node('small', t('开启后在刷新页面时切换存储位置。对话以明文随当前账户设置保存，换浏览器可读取；会增大 settings.json，每条最多8 MiB、总计32 MiB。尽量只用一个酒馆标签页，其他标签页保存设置可能覆盖记录。旧存储原件保留，不自动迁移；需要时先导出备份。关闭自动保存不会删除已有记录。', 'Takes effect after page reload. Plaintext conversations follow this ST account across browsers and enlarge settings.json: 8 MiB per record, 32 MiB total. Prefer one ST tab; another tab saving settings may overwrite records. Existing backend data is retained, not automatically migrated; export a backup first. Turning off auto-save does not delete records.'), section);
    const retry = button(t('重试保存', 'Retry saving'), section);
    const bar = node('div', '', chat); bar.className = 'gd-muyu-session-bar';
    const toggle = button(t('历史', 'History'), bar), title = node('strong', '', bar);
    const menu = node('details', '', bar); node('summary', '⋯', menu).setAttribute('aria-label', t('当前对话操作', 'Conversation actions'));
    const rename = button(t('重命名', 'Rename'), menu), archive = button(t('归档', 'Archive'), menu), remove = button(t('删除', 'Delete'), menu);
    const status = node('small', '', bar); status.setAttribute('role', 'status');
    const sidebar = node('aside', '', sidebarRoot || chat); sidebar.className = 'gd-muyu-history-sidebar'; sidebar.setAttribute('aria-label', t('暮羽历史会话', 'Muyu history'));
    const heading = node('div', '', sidebar); heading.className = 'gd-muyu-sidebar-heading';
    node('strong', t('对话', 'Conversations'), heading);
    const close = button(t('收起历史', 'Close history'), heading);
    const create = button(t('新对话', 'New conversation'), sidebar); create.className += ' gd-muyu-new-session';
    const actionsRoot = node('div', '', sidebar); actionsRoot.className = 'gd-muyu-sidebar-exchange';
    const actions = createHistoryActions({ doc, importRoot: actionsRoot, exportRoot: menu, parent: bar, controller, act, t });
    rename.onclick = () => { menu.open = false; actions.show('rename'); };
    archive.onclick = () => { menu.open = false; actions.show('archive'); };
    remove.onclick = () => { menu.open = false; actions.show('remove'); };
    const searchLabel = node('label', t('搜索标题', 'Search titles'), sidebar), search = node('input', '', searchLabel); search.type = 'search'; search.maxLength = 100; search.className = 'text_pole';
    const filtersPanel = node('details', '', sidebar); filtersPanel.className = 'gd-muyu-history-filters';
    node('summary', t('筛选对话', 'Filter conversations'), filtersPanel);
    const range = select(t('范围', 'Scope'), [['current', t('当前聊天', 'Current chat')], ['global', t('全局任务', 'Global tasks')], ['all', t('全部历史', 'All history')]], filtersPanel);
    const archived = select(t('记录', 'Records'), [['active', t('未归档', 'Active')], ['archived', t('已归档', 'Archived')], ['all', t('全部', 'All')]], filtersPanel);
    const task = select(t('任务类型', 'Task type'), [['', t('全部任务', 'All tasks')], ...Object.entries(taskCatalog).map(([id, item]) => [id, t(...item.label)])], filtersPanel);
    const refresh = button(t('加载／刷新本地历史', 'Load / refresh local history'), sidebar);
    const list = node('div', '', sidebar); list.className = 'gd-muyu-session-list';
    const count = node('small', '', sidebar);
    let opened = false, wide = false, manual = !!setSidebarOpen, signature = '', disposed = false, visible = true, available = false;
    function visibility() {
        const showing = opened && available;
        sidebar.hidden = !showing;
        if (workspace) workspace.className = 'gd-muyu-workspace' + (showing ? ' is-history-open' : '');
        toggle.setAttribute('aria-expanded', String(showing));
        close.textContent = wide ? t('收起历史', 'Close history') : t('返回聊天', 'Back to chat');
        setSidebarOpen?.(showing && visible);
    }
    function setOpen(value) { manual = true; opened = value; visibility(); (opened ? search : toggle).focus?.(); }
    toggle.onclick = () => setOpen(!opened); close.onclick = () => setOpen(false);
    sidebar.onkeydown = event => {
        if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); setOpen(false); }
        if (event.key === 'Tab' && !wide) {
            const controls = [...(sidebar.querySelectorAll?.('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary') || [])].filter(el => el.getClientRects?.().length !== 0);
            const target = event.shiftKey ? controls[0] : controls.at(-1);
            if (event.target === target && controls.length) { event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0]).focus(); }
        }
    };
    const resize = width => {
        wide = width >= 680; if (!manual) opened = wide; visibility();
        if (!wide && opened && available && visible && chat.contains?.(doc.activeElement)) search.focus?.();
    };
    const Resize = doc.defaultView?.ResizeObserver || globalThis.ResizeObserver;
    const observer = Resize && workspace ? new Resize(entries => resize(entries[0]?.contentRect.width || 0)) : null;
    if (observer) observer.observe(workspace); resize(workspace?.clientWidth || 0);
    search.oninput = () => act(() => controller.setHistoryFilters({ query: search.value }));
    range.onchange = () => act(() => controller.setHistoryFilters({ range: range.value }));
    archived.onchange = () => act(() => controller.setHistoryFilters({ archive: archived.value }));
    task.onchange = () => act(() => controller.setHistoryFilters({ task: task.value }));
    enabled.onchange = () => act(() => controller.setHistoryEnabled(enabled.checked));
    accountStorage.onchange = () => act(() => controller.setHistoryAccountStorage(accountStorage.checked));
    retry.onclick = () => act(() => controller.retryHistory());
    refresh.onclick = () => act(() => controller.refreshHistory());
    create.onclick = () => act(async () => { await controller.newSession(); if (!disposed && !wide) setOpen(false); });
    const labels = { idle: t('空闲', 'Idle'), running: t('运行中', 'Running'), succeeded: t('完成', 'Completed'), failed: t('失败', 'Failed'), cancelled: t('已取消', 'Cancelled'), interrupted: t('已中断', 'Interrupted') };
    return {
        render(s) {
            const h = s.history; bar.hidden = section.hidden = !h;
            available = !!h; visibility();
            if (!h) return;
            (task.parentElement || task.parent).hidden = s.mode === 'assistant';
            actions.render(s);
            enabled.checked = h.enabled; enabled.disabled = !h.available || h.loading || s.resetting || s.busy;
            storageLabel.hidden = storageNotice.hidden = !h.canChooseStorage;
            accountStorage.checked = h.accountStorage === true;
            accountStorage.disabled = !h.canChooseStorage || h.loading || s.resetting || s.busy;
            retry.disabled = !h.enabled || h.loading || !!h.pending || !h.error && !h.dirty; refresh.disabled = !h.available || h.loading || s.resetting;
            create.disabled = h.loading || s.resetting || !s.hasChat && !['draft', 'assistant'].includes(s.mode);
            rename.disabled = archive.disabled = remove.disabled = !h.sessionId || h.loading || s.resetting;
            archive.textContent = h.selected?.archived ? t('恢复归档', 'Restore archive') : t('归档', 'Archive');
            title.textContent = h.selected?.title || t('新对话', 'New conversation');
            const filters = h.filters || { range: 'all', archive: 'active', task: '', query: '' };
            range.value = filters.range; archived.value = filters.archive; task.value = filters.task; if (search.value !== filters.query) search.value = filters.query;
            const next = JSON.stringify([h.sessions, h.sessionId, s.resetting, h.loading]);
            if (signature !== next) {
                const focusedId = doc.activeElement?.getAttribute?.('data-session-id');
                signature = next; list.replaceChildren();
                if (!h.sessions.length) node('p', t('没有匹配的会话', 'No matching conversations'), list);
                for (const item of h.sessions) {
                    const row = node('div', '', list); row.className = 'gd-muyu-session-row';
                    const open = button(item.title || t('未命名对话', 'Untitled conversation'), row); open.setAttribute('aria-pressed', String(item.id === h.sessionId)); open.disabled = s.resetting || h.loading;
                    open.setAttribute('data-session-id', item.id);
                    const [kind, scopeKind, scopeKey] = JSON.parse(item.scope || '["chat"]');
                    if (scopeKind) node('small', scopeKind === 'global' ? t('全局任务', 'Global task') : t('聊天：', 'Chat: ') + String(scopeKey || '').slice(0, 80), row).className = 'gd-muyu-session-scope';
                    node('small', [t(...(taskCatalog[kind]?.label || ['未知任务', 'Unknown task'])), labels[item.status] || '', item.updatedAt ? new Date(item.updatedAt).toLocaleString() : '', item.imported ? t('只读备份', 'Read-only backup') : ''].filter(Boolean).join(' · '), row);
                    const itemMenu = node('details', '', row); node('summary', '⋯', itemMenu).setAttribute('aria-label', t('会话操作：', 'Actions: ') + (item.title || t('未命名', 'Untitled')));
                    for (const [action, text] of [['rename', t('重命名', 'Rename')], ['archive', item.archived ? t('恢复归档', 'Restore archive') : t('归档', 'Archive')], ['remove', t('删除', 'Delete')]]) {
                        const control = button(text, itemMenu); control.disabled = open.disabled;
                        control.onclick = () => act(async () => {
                            await controller.openSession(item.id);
                            if (disposed || controller.snapshot().history?.sessionId !== item.id) return;
                            if (!wide) setOpen(false); actions.show(action);
                        });
                    }
                    for (const [format, text] of [['json', t('导出 JSON', 'Export JSON')], ['markdown', t('导出 Markdown', 'Export Markdown')]]) {
                        const control = button(text, itemMenu); control.disabled = open.disabled;
                        control.onclick = () => act(async () => {
                            await controller.openSession(item.id);
                            if (disposed || controller.snapshot().history?.sessionId !== item.id) return;
                            itemMenu.open = false; actions.export(format);
                        });
                    }
                    open.onclick = () => act(async () => {
                        await controller.openSession(item.id);
                        if (!disposed && controller.snapshot().history?.sessionId === item.id) {
                            if (!wide) setOpen(false);
                            else list.querySelector?.(`[data-session-id="${item.id}"]`)?.focus();
                        }
                    });
                    if (focusedId === item.id) open.focus?.();
                }
            }
            count.textContent = `${h.sessions.length} / ${h.total ?? h.sessions.length} · ${t('归档仍占容量', 'Archives retain storage')}`;
            status.textContent = h.loading ? t('正在加载历史…', 'Loading history…') : h.error ? t('历史操作或保存失败；请先导出备份。', 'History operation/save failed; export a backup first.') : h.pending ? t('正在保存到本地…', 'Saving locally…') : !h.enabled ? h.dirty ? t('仅保留在本页；新内容未保存', 'This page only; new content is unsaved') : h.persisted ? t('本机有旧记录；新内容不会自动保存', 'An older local record exists; new content will not auto-save') : t('仅保留在本页；自动保存关闭', 'This page only; automatic saving is off') : h.dirty ? t('有未保存内容', 'Unsaved changes') : h.persisted ? t('已保存在本地', 'Saved locally') : t('自动保存已开启；发送后保存新对话', 'Automatic saving is on; new conversations save after sending');
            if (h.error === 'HISTORY_CONFLICT' || h.error === 'HISTORY_DELETED') status.textContent = t('另一标签页已更新或删除此记录；未覆盖。请先导出本页内容，再刷新页面核对。', 'Another tab updated or deleted this record; not overwritten. Export this version before reloading the page.');
            if (h.recovery) status.textContent = t('回答仍在本页，但已超过存档容量，未保存。请立即导出恢复备份，再新建对话；恢复 JSON 仅作备份，不能直接导入。', 'The answer remains on this page but exceeds archive capacity and is unsaved. Export a recovery backup now, then start a new conversation. Recovery JSON is a backup, not an importable session.');
            if (h.migration?.pending) status.textContent += t(` · ${h.migration.pending} 份浏览器记录因容量不足待迁移；原件保留。可先导出／删除服务端旧记录，再刷新历史重试。`, ` · ${h.migration.pending} browser records await migration due to capacity; originals remain. Export/delete old server records, then refresh history to retry.`);
            if (h.restoredStatus === 'interrupted') status.textContent += t(' · 上次任务已中断，未自动恢复', ' · Previous run interrupted; not resumed');
            if (s.switchedChat && !s.readOnly) status.textContent += t(' · 已切换 ST 聊天：继续发送会使用当前聊天，并告知暮羽重新核对资料', ' · ST chat changed: the next message uses this chat and tells Muyu to recheck its data');
            if (s.readOnly) status.textContent += h.selected?.imported ? t(' · 导入备份：只读，不会发送给模型', ' · Imported backup: read-only, not sent to a model') : h.selected?.archived ? t(' · 已归档：恢复后才能继续', ' · Archived: restore to continue') : t(' · 其他聊天历史：只读，请在原聊天继续', ' · Other chat: read-only; continue in its original chat');
            if (s.readOnly && h.selected?.scope) {
                const [task, kind, key] = JSON.parse(h.selected.scope);
                status.textContent += ' · ' + t(...taskCatalog[task].label) + ' · ' + (kind === 'global' ? t('全局任务', 'Global task') : key.slice(0, 160));
            }
            if (h.missingPermissions?.length && !s.readOnly) status.textContent += t(' · 继续前请在配置中重新授权相关资料', ' · Reauthorize relevant data before continuing');
            if (h.omitted) status.textContent += t(' · 继续时仅发送预算内完整问答', ' · Continuation sends complete turns within the history budget');
            if (h.enabled && h.backend === 'private-files') status.textContent += t(' · ST 私有文件', ' · Private ST files');
            else if (h.enabled && h.backend === 'browser') status.textContent += t(' · 浏览器 IndexedDB', ' · Browser IndexedDB');
            else if (h.enabled && h.backend === 'account-settings') status.textContent += t(' · 酒馆账户设置', ' · ST account settings');
            if (h.canChooseStorage && h.backend !== 'memory' && (h.backend === 'account-settings') !== h.accountStorage) status.textContent += t(' · 存储选项已保存，刷新后生效；当前仍使用原位置', ' · Storage preference saved; reload to switch. Current storage is unchanged');
        },
        setVisible(value) { visible = value; visibility(); },
        dispose() { disposed = true; observer?.disconnect(); actions.dispose(); setSidebarOpen?.(false); },
    };
}
