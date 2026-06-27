import { registerSection } from './registry.js';

registerSection('dashboard', function (ctx) {
    const {
        settings, $c, saveSettings, getDirectorHistory, getProfiles,
        memorySystem, npcSystem, loadConfigPreset, getConfigPresetNames,
        isRoundActive, saveChatConditional, getChat, toastr,
    } = ctx;

    // ── Card collapse state persistence ──────────────────────────
    if (!settings.uiState) settings.uiState = {};
    if (!settings.uiState.cardStates) settings.uiState.cardStates = {};

    function saveUiState() { saveSettings(); }

    function initCard(cardEl) {
        const name = cardEl.dataset.card;
        const $card = $(cardEl);
        const $body = $card.find('.gd-card-body');

        // Restore persisted state
        if (name && settings.uiState.cardStates[name]) {
            $card.addClass('is-expanded');
            $body.show();
        }

        $card.find('.gd-card-header').on('click', () => {
            const expanded = $card.hasClass('is-expanded');
            if (expanded) {
                $card.removeClass('is-expanded');
                $body.slideUp(180);
                if (name) { settings.uiState.cardStates[name] = false; saveUiState(); }
            } else {
                $card.addClass('is-expanded');
                $body.slideDown(180);
                if (name) { settings.uiState.cardStates[name] = true; saveUiState(); }
            }
        });
    }

    // Init all collapsible cards
    document.querySelectorAll('.gd-card-collapsible').forEach(initCard);

    // ── Dashboard: mode indicator ──────────────────────────────
    const $dot = $('#gd-status-dot');
    const $badge = $('#gd-mode-badge');
    const $label = $('#gd-mode-label');
    const lang = settings.lang || 'zh';

    function refreshMode() {
        const mode = settings.mode;
        $dot.removeClass('is-live is-formula is-off');
        if (mode === 'llm') {
            $dot.addClass('is-live');
            $badge.text(lang === 'zh' ? 'LLM' : 'LLM').show();
            $label.text(lang === 'zh' ? '导演 · LLM 模式' : 'Director · LLM');
        } else if (mode === 'formula') {
            $dot.addClass('is-formula');
            $badge.text(lang === 'zh' ? '公式' : 'Formula').show();
            $label.text(lang === 'zh' ? '导演 · 公式模式' : 'Director · Formula');
        } else {
            $dot.addClass('is-off');
            $badge.hide();
            $label.text(lang === 'zh' ? '导演 · 已关闭' : 'Director · Off');
        }
    }

    // ── Dashboard: last decision ────────────────────────────────
    function refreshDecision() {
        const history = getDirectorHistory();
        const $wrapper = $('#gd-dashboard-decision');
        const $speakers = $('#gd-decision-speakers');
        const $reason = $('#gd-decision-reason');

        if (!history.length) {
            $wrapper.hide();
            return;
        }
        const last = history[history.length - 1];
        const names = Array.isArray(last.speakers) ? last.speakers : [];
        $speakers.text(names.join(' → ') || (lang === 'zh' ? '(无)' : '(none)'));
        if (last.reason) {
            $reason.text(last.reason).show();
        } else {
            $reason.hide();
        }
        $wrapper.show();
    }

    // ── Dashboard: stats ─────────────────────────────────────────
    function refreshStats() {
        try {
            const profiles = getProfiles?.() || {};
            const entries = Object.values(profiles).filter(p => p && p.state === 'ready');
            $('#gd-stat-profiles .gd-stat-value').text(entries.length);
        } catch (_) {}

        try {
            const stats = memorySystem.getStats?.() || {};
            const total = Object.values(stats).reduce((s, v) => s + (v.count || 0), 0);
            $('#gd-stat-memories .gd-stat-value').text(total);
        } catch (_) {}

        try {
            const npcs = npcSystem.getNpcs?.() || [];
            $('#gd-stat-npcs .gd-stat-value').text(npcs.length);
        } catch (_) {}

        try {
            const history = getDirectorHistory();
            $('#gd-stat-ledger .gd-stat-value').text(history.length);
        } catch (_) {}
    }

    // ── Dashboard: drawer badges ─────────────────────────────────
    function refreshDrawerBadges() {
        try {
            const profiles = getProfiles?.() || {};
            const ready = Object.values(profiles).filter(p => p && p.state === 'ready').length;
            const total = Object.values(profiles).filter(p => p).length;
            const $b = $('#gd-badge-cast');
            if (total) { $b.text(ready + '/' + total).show(); }
        } catch (_) {}

        try {
            const history = getDirectorHistory();
            const $b = $('#gd-badge-continuity');
            if (history.length) { $b.text(history.length).show(); }
        } catch (_) {}

        try {
            const caps = ctx.CapabilityRegistry?.list?.() || [];
            const enabled = caps.filter(c => c.enabled !== false).length;
            const $b = $('#gd-badge-reactions');
            if (enabled) { $b.text(enabled).show(); }
        } catch (_) {}
    }

    // ── Dashboard: card status labels ────────────────────────────
    function refreshCardStatuses() {
        try {
            const profiles = getProfiles?.() || {};
            const ready = Object.values(profiles).filter(p => p && p.state === 'ready').length;
            const $s = $('#gd-card-status-profile');
            $s.text(ready ? ready + ' ready' : settings.profileEnabled ? '...' : 'off');
            $s.css('color', ready ? '#4caf50' : '');
        } catch (_) {}

        try {
            const stats = memorySystem.getStats?.() || {};
            const total = Object.values(stats).reduce((s, v) => s + (v.count || 0), 0);
            const $s = $('#gd-card-status-memory');
            $s.text(total ? total + ' entries' : settings.memoryEnabled ? '...' : 'off');
            $s.css('color', total ? '#4caf50' : '');
        } catch (_) {}

        try {
            const npcs = npcSystem.getNpcs?.() || [];
            const $s = $('#gd-card-status-npc');
            $s.text(npcs.length ? npcs.length + ' NPCs' : settings.npcEnabled ? '...' : 'off');
            $s.css('color', npcs.length ? '#4caf50' : '');
        } catch (_) {}

        try {
            const history = getDirectorHistory();
            const $s = $('#gd-card-status-ledger');
            $s.text(history.length ? history.length + ' rounds' : 'empty');
            $s.css('color', history.length ? '#4caf50' : '');
        } catch (_) {}

        try {
            const $s = $('#gd-card-status-ps-msg');
            $s.text(settings.postSpeechMessageEnabled ? 'ON' : 'off');
            $s.css('color', settings.postSpeechMessageEnabled ? '#4caf50' : '');
        } catch (_) {}

        try {
            const $s = $('#gd-card-status-ps-round');
            $s.text(settings.postSpeechRoundEnabled ? 'ON' : 'off');
            $s.css('color', settings.postSpeechRoundEnabled ? '#4caf50' : '');
        } catch (_) {}

        try {
            const presets = getConfigPresetNames?.() || [];
            const $s = $('#gd-card-status-config');
            if (presets.length) { $s.text(presets.length + ' saved').show(); }
        } catch (_) {}
    }

    // ── Dashboard: preset/profile selector ──────────────────────
    const PROF_PREFIX = '__prof__:'; // value prefix to distinguish user profiles from system presets

    function refreshPresetSelector() {
        const presets = getConfigPresetNames?.() || [];
        const sysProfiles = ctx.configProfileSystem?.getProfiles?.() || [];
        // Update both dashboard dropdown and card dropdown
        for (const selId of ['gd-dash-cfg-preset', 'gd-cfg-preset']) {
            const $sel = $(`#${selId}`);
            if (!$sel.length) continue;
            const current = $sel.val();
            $sel.find('option:not(:first)').remove();
            $sel.find('optgroup').remove();
            // System presets
            if (presets.length) {
                const $grp = $('<optgroup>').attr('label', lang === 'zh' ? '内置配置档' : 'System Presets');
                for (const name of presets) {
                    $grp.append(`<option value="${name.replace(/"/g, '&quot;')}">${name}</option>`);
                }
                $sel.append($grp);
            }
            // User profiles
            if (sysProfiles.length) {
                const $grp = $('<optgroup>').attr('label', lang === 'zh' ? '我的配置档' : 'My Profiles');
                for (const p of sysProfiles) {
                    $grp.append(`<option value="${PROF_PREFIX}${p.id}">${p.name.replace(/"/g, '&quot;')}</option>`);
                }
                $sel.append($grp);
            }
            if (current) $sel.val(current);
        }
    }

    // Sync config profile list card with dashboard operations
    function syncConfigList() {
        const $card = $('#gd-config-profiles-list').closest('.gd-card-collapsible');
        if ($card.length && !$card.hasClass('is-expanded')) {
            $card.addClass('is-expanded');
            $card.find('.gd-card-body').show();
        }
        if (typeof window.__gdRefreshConfigList === 'function') {
            window.__gdRefreshConfigList();
        }
    }

    // ── Dashboard: manual preset list refresh ───────────────────
    $('#gd-dash-preset-refresh').on('click', function () {
        refreshPresetSelector();
        const $icon = $(this).find('i');
        $icon.addClass('fa-spin');
        setTimeout(() => $icon.removeClass('fa-spin'), 500);
    });

    // ── Dashboard: preset/profile apply ──────────────────────────
    $('#gd-dashboard-preset-apply').on('click', async () => {
        const rawValue = $('#gd-dash-cfg-preset').val();
        if (!rawValue) { toastr?.warning?.(lang === 'zh' ? '请先选择一个配置档' : 'Select a profile first'); return; }
        const btn = $('#gd-dashboard-preset-apply'); btn.prop('disabled', true);
        try {
            if (rawValue.startsWith(PROF_PREFIX)) {
                // User profile — apply directly by ID
                const id = rawValue.slice(PROF_PREFIX.length);
                ctx.configProfileSystem?.applyProfile(id);
                const p = ctx.configProfileSystem?.getProfiles?.().find(p => p.id === id);
                toastr?.success?.(lang === 'zh'
                    ? `已应用「${p?.name || id}」，请刷新页面以完全生效`
                    : `"${p?.name || id}" applied. Refresh page for full effect.`);
            } else {
                // System preset — load then apply
                const profile = await loadConfigPreset(rawValue);
                ctx.configProfileSystem?.applyProfile(profile.id);
                toastr?.success?.(lang === 'zh'
                    ? `已应用「${profile.name}」，请刷新页面以完全生效`
                    : `"${profile.name}" applied. Refresh page for full effect.`);
            }
            syncConfigList();
            refreshAll();
        } catch (e) {
            toastr?.error?.(lang === 'zh' ? `应用失败: ${e.message}` : `Failed: ${e.message}`);
        } finally { btn.prop('disabled', false); }
    });

    // ── Dashboard: import config profile ────────────────────────
    $('#gd-dash-import-cfg').on('click', () => $('#gd-dash-import-file').click());
    $('#gd-dash-import-file').on('change', async function () {
        const file = this.files[0];
        if (!file) return;
        const btn = $('#gd-dash-import-cfg'); btn.prop('disabled', true);
        try {
            const profile = await ctx.configProfileSystem?.importProfileFromZip(file);
            toastr?.success?.(lang === 'zh'
                ? `已导入「${profile.name}」，请刷新页面以完全生效`
                : `"${profile.name}" imported. Refresh page for full effect.`);
            syncConfigList();
            refreshAll();
        } catch (e) {
            toastr?.error?.(lang === 'zh' ? `导入失败: ${e.message}` : `Import failed: ${e.message}`);
        } finally { btn.prop('disabled', false); this.value = ''; }
    });

    // ── Dashboard: quick action buttons ─────────────────────────

    // 扫描存档: profile scan + refresh memory list
    $('#gd-dash-scan').on('click', () => {
        const group = ctx.getCurrentGroup?.();
        if (!group) { toastr?.warning?.(lang === 'zh' ? '请先在群聊中打开此设置面板' : 'Open settings from a group chat first'); return; }
        $('#gd-profile-scan-save').trigger('click');
        $('#gd-memory-refresh').trigger('click');
        setTimeout(refreshAll, 1500);
    });

    // 生成档案
    $('#gd-dash-profiles').on('click', () => {
        const group = ctx.getCurrentGroup?.();
        if (!group) { toastr?.warning?.(lang === 'zh' ? '请先在群聊中打开此设置面板' : 'Open settings from a group chat first'); return; }
        $('#gd-profile-regenerate-all').trigger('click');
        setTimeout(refreshAll, 2000);
    });

    // 提取记忆: directly call generateForCharacter for each group member
    $('#gd-dash-memories').on('click', async () => {
        const group = ctx.getCurrentGroup?.();
        if (!group) { toastr?.warning?.(lang === 'zh' ? '请先在群聊中打开此设置面板' : 'Open settings from a group chat first'); return; }
        const chars = ctx.getCharacters?.() || [];
        const members = group.members.filter(a => !group.disabled_members?.includes(a));
        if (!members.length) { toastr?.warning?.(lang === 'zh' ? '当前群聊没有可用角色' : 'No enabled members'); return; }
        toastr?.info?.(lang === 'zh' ? `正在为 ${members.length} 个角色提取记忆...` : `Extracting memories for ${members.length} characters...`);
        const btn = $('#gd-dash-memories'); btn.prop('disabled', true);
        let done = 0;
        for (const avatar of members) {
            try { await memorySystem.generateForCharacter(avatar); } catch (e) { console.warn('[GroupDirector] Memory extraction failed for', avatar, e); }
            done++;
        }
        btn.prop('disabled', false);
        toastr?.success?.(lang === 'zh' ? `已为 ${done} 个角色完成记忆提取` : `Memory extraction done for ${done} characters`);
        refreshAll();
    });

    // 执行总结
    $('#gd-dash-summary').on('click', () => {
        const group = ctx.getCurrentGroup?.();
        if (!group) { toastr?.warning?.(lang === 'zh' ? '请先在群聊中打开此设置面板' : 'Open settings from a group chat first'); return; }
        if (!settings.summaryEnabled) {
            settings.summaryEnabled = true;
            saveSettings();
            $('#gd-summary-enabled').prop('checked', true);
            $('#gd-summary-execute').prop('disabled', false);
            toastr?.info?.(lang === 'zh' ? '已自动启用上下文总结' : 'Chat summary auto-enabled');
        }
        $('#gd-summary-execute').trigger('click');
        setTimeout(refreshAll, 2000);
    });

    function refreshQuickActions() {
        const group = !!ctx.getCurrentGroup?.();
        $('#gd-dash-scan').toggle(group && (settings.profileEnabled || settings.memoryEnabled));
        $('#gd-dash-profiles').toggle(group && settings.profileEnabled);
        $('#gd-dash-memories').toggle(group && settings.memoryEnabled);
        $('#gd-dash-summary').toggle(group);
    }

    // ── Script detail card toggle ───────────────────────────────
    $('#gd-llm-script-enabled').on('input', function () {
        $('#gd-script-detail').toggle(!!$(this).prop('checked'));
    });
    // Init script detail state
    $('#gd-script-detail').toggle(!!settings.llmScriptEnabled);

    // ── Continuity detail toggle ─────────────────────────────────
    $('#gd-llm-script-continuity').on('input', function () {
        $('#gd-continuity-detail').toggle(!!$(this).prop('checked'));
    });
    $('#gd-continuity-detail').toggle(!!settings.llmScriptContinuity);

    // ── Refresh all dashboard data ───────────────────────────────
    function refreshAll() {
        refreshMode();
        refreshDecision();
        refreshStats();
        refreshDrawerBadges();
        refreshCardStatuses();
        refreshQuickActions();
        refreshPresetSelector();
    }

    // Initial load
    refreshMode();
    refreshDecision();
    refreshStats();
    refreshDrawerBadges();
    refreshCardStatuses();
    refreshQuickActions();
    refreshPresetSelector();

    // Refresh when any drawer is toggled (user may have made changes)
    $('.inline-drawer-toggle').on('click', function () {
        setTimeout(refreshAll, 300); // wait for drawer animation
    });

    // Expose refresh for other sections
    window.__gdRefreshDashboard = refreshAll;
});
