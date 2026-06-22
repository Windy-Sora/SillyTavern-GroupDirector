/**
 * Quick Start — mirrored controls in drawer 1 ("模式与开始").
 *
 * Duplicates Profile enabled checkbox + regenerate + card list,
 * and World Book checkbox list. Both locations share the same
 * settings keys and DOM logic — no duplicated state.
 *
 * Renders its own mini HTML, but delegates full rebuilds to
 * ctx.renderProfileManagementList() and ctx.renderWorldBookList()
 * which both sections expose on ctx.
 */
import { registerSection } from './registry.js';

registerSection('quickStart', function (ctx) {
    const { settings, $c, saveSettings, generateProfilesBatch, getProfiles,
        getCurrentGroup, toastr, world_names } = ctx;
    const isZh = () => (settings.lang || 'zh') === 'zh';

    const $container = $('#gd-quick-start');
    if (!$container.length) return;

    // ── Build initial HTML ───────────────────────────────────────────

    function escHtml(s) {
        if (s === null || s === undefined) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function buildHtml() {
        let html = '';

        // ── Profile section ──
        html += `<div style="margin-bottom:6px;">
            <label class="checkbox_label" for="gd-qs-profile-enabled">
                <input type="checkbox" id="gd-qs-profile-enabled">
                <span data-i18n="profileEnabled">启用角色档案</span>
            </label>
            <span class="menu_button menu_button_icon" id="gd-qs-profile-regenerate-all" style="margin-left:8px;font-size:0.8em;">
                <i class="fa-solid fa-arrows-rotate"></i> <span data-i18n="profileRegenerateAll">全部重新生成</span>
            </span>
            <div id="gd-qs-profile-list" style="margin-top:4px;max-height:150px;overflow-y:auto;font-size:0.85em;"></div>
        </div>`;

        // ── World Books section ──
        html += `<div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
                <span style="font-weight:bold;font-size:0.85em;">${isZh() ? '世界书' : 'World Books'}</span>
                <span class="menu_button menu_button_icon" id="gd-qs-wb-refresh" style="font-size:0.7em;padding:1px 6px;cursor:pointer;" title="${isZh() ? '刷新' : 'Refresh'}" onclick="window._gdQuickRefreshWb && window._gdQuickRefreshWb()">
                    <i class="fa-solid fa-rotate"></i>
                </span>
            </div>
            <div id="gd-qs-worldbook-list" style="font-size:0.85em;max-height:120px;overflow-y:auto;"></div>
        </div>`;

        $container.html(html);
    }

    buildHtml();

    // ── Profile controls ────────────────────────────────────────────

    $c('qs-profile-enabled').prop('checked', settings.profileEnabled ?? false);

    $c('qs-profile-enabled').on('change', function () {
        settings.profileEnabled = !!$(this).prop('checked');
        $c('profile-enabled').prop('checked', settings.profileEnabled); // sync original
        $('#gd-profile-section').toggle(settings.profileEnabled);
        saveSettings();
        if (settings.profileEnabled) refreshQuickProfileList();
    });

    $c('qs-profile-regenerate-all').on('click', async function () {
        const group = getCurrentGroup();
        if (!group) { toastr.warning(isZh() ? '请先加入群聊' : 'Join a group first'); return; }
        const members = group.members.filter(a => !group.disabled_members?.includes(a));
        if (!members.length) { toastr.warning(isZh() ? '无可用角色' : 'No members'); return; }
        const btn = $(this); btn.prop('disabled', true);
        try {
            await generateProfilesBatch(members);
            const profiles = getProfiles();
            const ready = Object.values(profiles).filter(p => p.state === 'ready').length;
            refreshQuickProfileList();
            if (ctx.renderProfileManagementList) ctx.renderProfileManagementList();
            toastr.success(isZh() ? `${ready} 个档案已就绪` : `${ready} profiles ready`);
        } catch (e) { toastr.error((isZh() ? '生成失败' : 'Failed') + ': ' + e.message); }
        finally { btn.prop('disabled', false); }
    });

    // ── Mini profile list renderer ───────────────────────────────────

    function refreshQuickProfileList() {
        const $list = $('#gd-qs-profile-list');
        if (!$list.length) return;

        const profiles = getProfiles ? getProfiles() : {};
        const all = Object.values(profiles);
        const ready = all.filter(p => p.state === 'ready');
        const pending = all.filter(p => p.state === 'pending');
        const failed = all.filter(p => p.state === 'failed');

        if (!all.length) {
            $list.html(`<small style="color:var(--grey70a);">${isZh() ? '暂无档案' : 'No profiles yet'}</small>`);
            return;
        }

        const stateColor = { ready: '#4caf50', pending: '#ff9800', failed: '#f44336' };
        const stateLabel = isZh()
            ? { ready: '就绪', pending: '生成中', failed: '失败' }
            : { ready: 'Ready', pending: 'Pending', failed: 'Failed' };

        let html = '';
        for (const p of [...ready, ...pending, ...failed]) {
            html += `<span style="margin-right:8px;white-space:nowrap;">
                <span style="color:${stateColor[p.state]};font-size:0.8em;">&#9679;</span>
                ${escHtml(p.name)}

            </span>`;
        }
        html += `<small style="color:var(--grey70a);">(${ready.length}/${all.length})</small>`;
        $list.html(html);
    }

    // ── World Books mini list renderer ───────────────────────────────

    function refreshQuickWorldBookList() {
        const $list = $('#gd-qs-worldbook-list');
        if (!$list.length) return;

        const names = world_names || [];
        if (!names.length) {
            $list.html(`<small style="color:var(--grey70a);">${isZh() ? '无世界书' : 'No world books'}</small>`);
            return;
        }

        const selection = settings.worldBookSelection || {};
        const checked = names.filter(n => selection[n]);
        const unchecked = names.filter(n => !selection[n]);

        let html = '';
        for (const name of checked) {
            html += `<label class="checkbox_label" style="display:block;font-size:0.8em;">
                <input type="checkbox" class="gd-qs-wb-check" data-book="${escHtml(name)}" data-book-esc="${escHtml(name)}" checked> ${escHtml(name)}
            </label>`;
        }
        for (const name of unchecked) {
            html += `<label class="checkbox_label" style="display:block;font-size:0.8em;color:var(--grey70a);">
                <input type="checkbox" class="gd-qs-wb-check" data-book="${escHtml(name)}" data-book-esc="${escHtml(name)}"> ${escHtml(name)}
            </label>`;
        }

        $list.html(html);

        // Bind checkboxes
        $list.find('.gd-qs-wb-check').off('change').on('change', function () {
            const name = $(this).attr('data-book');
            settings.worldBookSelection[name] = !!$(this).prop('checked');
            saveSettings();
            // Sync the original list (uses different DOM, same settings)
            if (ctx.renderWorldBookList) ctx.renderWorldBookList();
        });
    }

    // ── Sync from source sections ────────────────────────────────────
    // When source sections refresh, they call these ctx functions.
    // Wrap them to also refresh our quick-start mini lists.

    function wrapRefresh(fn, quickFn) {
        if (typeof fn !== 'function') return fn;
        return async function () {
            const result = await fn.apply(this, arguments);
            try { quickFn(); } catch (_) {}
            return result;
        };
    }

    // Override ctx functions to auto-sync our mini lists
    if (typeof ctx.renderProfileManagementList === 'function') {
        ctx.renderProfileManagementList = wrapRefresh(ctx.renderProfileManagementList, refreshQuickProfileList);
    }
    if (typeof ctx.renderWorldBookList === 'function') {
        ctx.renderWorldBookList = wrapRefresh(ctx.renderWorldBookList, refreshQuickWorldBookList);
    }

    // World books refresh — handled via inline onclick on the span element
    // that calls window._gdQuickRefreshWb (registered below)

    // Register global refresh for inline onclick
    window._gdQuickRefreshWb = () => {
        refreshQuickWorldBookList();
        toastr.info(isZh() ? '世界书列表已刷新' : 'World book list refreshed');
    };

    // ── Initial render ───────────────────────────────────────────────

    if (settings.profileEnabled) refreshQuickProfileList();
    refreshQuickWorldBookList();
});
