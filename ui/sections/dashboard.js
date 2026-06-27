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

    // ── Dashboard: expandable stat panels ───────────────────────
    const statPanels = {
        profiles: { stat: 'gd-stat-profiles', panel: 'gd-dash-panel-profiles', list: 'gd-dash-panel-profiles-list' },
        memories: { stat: 'gd-stat-memories', panel: 'gd-dash-panel-memories', list: 'gd-dash-panel-memories-list' },
        npcs:     { stat: 'gd-stat-npcs',     panel: 'gd-dash-panel-npcs',     list: 'gd-dash-panel-npcs-list' },
        ledger:   { stat: 'gd-stat-ledger',   panel: 'gd-dash-panel-ledger',   list: 'gd-dash-panel-ledger-list' },
    };

    function esc(s) { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function makeToggleRow($row, $detail) {
        $row.css('cursor', 'pointer');
        $row.on('click', () => { $detail.toggle(120); });
    }

    function renderPanelProfiles() {
        const profiles = getProfiles?.() || {};
        const chars = ctx.getCharacters?.() || [];
        const $list = $('#gd-dash-panel-profiles-list').empty();
        const entries = Object.entries(profiles).filter(([, p]) => p);
        if (!entries.length) { $list.append(`<small>${lang === 'zh' ? '暂无角色档案' : 'No profiles'}</small>`); return; }
        for (const [av, p] of entries) {
            const c = chars.find(c => c.avatar === av);
            const name = c?.name || p.name || av;
            const state = p.state || 'unknown';
            const color = { ready: '#4caf50', pending: '#ff9800', failed: '#f44336' }[state] || '';
            const profile = p.profile || {};
            const detail = [profile.summary, profile.tags && (lang === 'zh' ? '标签：' : 'Tags: ') + [].concat(profile.tags).join(', '), profile.motivation && (lang === 'zh' ? '动机：' : 'Motivation: ') + profile.motivation].filter(Boolean).join('<br>');
            const $row = $(`<div class="gd-list-item gd-list-expandable"><span class="gd-list-name">${esc(name)} ▸</span><span class="gd-list-meta" style="color:${color}">${state}</span></div>`);
            const $detail = $(`<div class="gd-list-detail" style="display:none;padding:4px 8px;font-size:0.9em;color:var(--grey70a);">${detail || (lang === 'zh' ? '(空)' : '(empty)')}</div>`);
            makeToggleRow($row, $detail);
            $list.append($row, $detail);
        }
    }

    function renderPanelMemories() {
        const stats = memorySystem.getStats?.() || {};
        const $list = $('#gd-dash-panel-memories-list').empty();
        const entries = Object.entries(stats);
        if (!entries.length) { $list.append(`<small>${lang === 'zh' ? '暂无角色记忆' : 'No memories'}</small>`); return; }
        for (const [av, s] of entries) {
            const mems = memorySystem.listMemories?.(av) || [];
            const detail = mems.length ? mems.slice(-5).reverse().map(m => `· ${esc(m.event || '')} ${m.mood ? `[${m.mood}]` : ''}`).join('<br>') : (lang === 'zh' ? '(空)' : '(empty)');
            const $row = $(`<div class="gd-list-item gd-list-expandable"><span class="gd-list-name">${esc(s.name || av)} ▸</span><span class="gd-list-meta">${s.count || 0} ${lang === 'zh' ? '条' : 'entries'}</span></div>`);
            const $detail = $(`<div class="gd-list-detail" style="display:none;padding:4px 8px;font-size:0.9em;color:var(--grey70a);">${detail}</div>`);
            makeToggleRow($row, $detail);
            $list.append($row, $detail);
        }
    }

    function renderPanelNpcs() {
        const npcs = npcSystem.getNpcs?.() || [];
        const $list = $('#gd-dash-panel-npcs-list').empty();
        if (!npcs.length) { $list.append(`<small>${lang === 'zh' ? '暂无 NPC' : 'No NPCs'}</small>`); return; }
        for (const n of npcs) {
            const detail = [
                n.description && (lang === 'zh' ? '描述：' : 'Desc: ') + n.description,
                n.personality && (lang === 'zh' ? '性格：' : 'Personality: ') + n.personality,
                n.scenario && (lang === 'zh' ? '背景：' : 'Scenario: ') + n.scenario,
            ].filter(Boolean).join('<br>');
            const desc = (n.description || '').slice(0, 40);
            const $row = $(`<div class="gd-list-item gd-list-expandable"><span class="gd-list-name">${esc(n.name || '?')} ▸</span><span class="gd-list-meta">${esc(desc)}${n.description?.length > 40 ? '...' : ''}</span></div>`);
            const $detail = $(`<div class="gd-list-detail" style="display:none;padding:4px 8px;font-size:0.9em;color:var(--grey70a);">${detail || (lang === 'zh' ? '(空)' : '(empty)')}</div>`);
            makeToggleRow($row, $detail);
            $list.append($row, $detail);
        }
    }

    function renderPanelLedger() {
        const history = getDirectorHistory();
        const $list = $('#gd-dash-panel-ledger-list').empty();
        if (!history.length) { $list.append(`<small>${lang === 'zh' ? '暂无账本记录' : 'No ledger entries'}</small>`); return; }
        const recent = history.slice(-8).reverse();
        for (let i = 0; i < recent.length; i++) {
            const e = recent[i];
            const speakers = Array.isArray(e.speakers) ? e.speakers.join(', ') : '';
            const reason = e.reason || '';
            const scripts = e.scripts && typeof e.scripts === 'object' ? Object.entries(e.scripts).map(([k, v]) => `${esc(k)}: ${esc(String(v).slice(0, 80))}`).join('<br>') : '';
            const detail = [reason && (lang === 'zh' ? '理由：' : 'Reason: ') + reason, scripts && ((lang === 'zh' ? '剧本：' : 'Scripts: ') + '<br>' + scripts)].filter(Boolean).join('<br><br>');
            const reasonShort = reason.slice(0, 50);
            const $row = $(`<div class="gd-list-item gd-list-expandable"><span class="gd-list-name">#${history.length - i} ${esc(speakers)} ▸</span><span class="gd-list-meta">${esc(reasonShort)}${reason.length > 50 ? '...' : ''}</span></div>`);
            const $detail = $(`<div class="gd-list-detail" style="display:none;padding:4px 8px;font-size:0.9em;color:var(--grey70a);">${detail || (lang === 'zh' ? '(无详情)' : '(no details)')}</div>`);
            makeToggleRow($row, $detail);
            $list.append($row, $detail);
        }
    }

    const panelRenderers = { profiles: renderPanelProfiles, memories: renderPanelMemories, npcs: renderPanelNpcs, ledger: renderPanelLedger };

    let openPanel = null;
    function togglePanel(name) {
        const cfg = statPanels[name];
        if (!cfg) return;
        const $panel = $(`#${cfg.panel}`);
        if (openPanel === name) {
            $panel.slideUp(150);
            openPanel = null;
        } else {
            if (openPanel) { $(`#${statPanels[openPanel].panel}`).slideUp(100); }
            panelRenderers[name]?.();
            $panel.slideDown(150);
            openPanel = name;
        }
    }

    // Bind stat clicks
    for (const [name, cfg] of Object.entries(statPanels)) {
        $(`#${cfg.stat}`).on('click', () => togglePanel(name));
    }
    // Bind close buttons
    $('.gd-dash-panel-close').on('click', function () {
        const name = $(this).data('panel');
        $(`#${statPanels[name]?.panel}`).slideUp(150);
        if (openPanel === name) openPanel = null;
    });

    // ── Dashboard: world book inline list ───────────────────────
    const $wbPanel = $('#gd-dash-worldbooks');
    const $wbCount = $('#gd-dash-worldbooks-count');
    const $wbList = $('#gd-dash-worldbook-list');

    function refreshWorldBookStat() {
        const sel = settings.worldBookSelection || {};
        const names = ctx.world_names || [];
        const checked = names.filter(n => sel[n] === true).length;
        $('#gd-stat-worldbooks .gd-stat-value').text(names.length ? `${checked}/${names.length}` : '-');
    }

    function renderDashWorldBookList() {
        if (!settings.worldBookSelection) settings.worldBookSelection = {};
        const names = ctx.world_names || [];
        const sel = settings.worldBookSelection;
        $wbList.empty();
        if (!names.length) {
            $wbList.append(`<small>${lang === 'zh' ? '未找到任何世界书' : 'No world books found'}</small>`);
            return;
        }
        const $toolbar = $('<div style="margin-bottom:4px;display:flex;gap:4px;"></div>');
        const $all = $(`<span class="menu_button menu_button_icon" style="font-size:0.75em;cursor:pointer;"><i class="fa-solid fa-check-double"></i> ${lang === 'zh' ? '全选' : 'All'}</span>`);
        const $none = $(`<span class="menu_button menu_button_icon" style="font-size:0.75em;cursor:pointer;"><i class="fa-solid fa-xmark"></i> ${lang === 'zh' ? '取消' : 'None'}</span>`);
        $all.on('click', () => { for (const n of names) sel[n] = true; saveSettings(); renderDashWorldBookList(); refreshWorldBookStat(); });
        $none.on('click', () => { for (const n of names) sel[n] = false; saveSettings(); renderDashWorldBookList(); refreshWorldBookStat(); });
        $toolbar.append($all, $none);
        $wbList.append($toolbar);
        let totalChecked = 0;
        for (const name of names) {
            const checked = sel[name] === true;
            if (checked) totalChecked++;
            const $label = $(`<label class="checkbox_label" style="display:flex;align-items:center;gap:4px;"></label>`);
            const $input = $(`<input type="checkbox">`);
            $input.prop('checked', checked);
            $input.on('change', function () { sel[name] = !!$(this).prop('checked'); saveSettings(); refreshWorldBookStat(); });
            $label.append($input, name);
            $wbList.append($label);
        }
        $wbCount.text(lang === 'zh' ? `已选 ${totalChecked}/${names.length}` : `${totalChecked}/${names.length} selected`);
    }

    // Toggle world book panel via stat click
    $('#gd-stat-worldbooks').on('click', () => {
        if ($wbPanel.is(':visible')) {
            $wbPanel.slideUp(150);
        } else {
            renderDashWorldBookList();
            $wbPanel.slideDown(150);
        }
    });
    $('#gd-dash-worldbooks-close').on('click', () => $wbPanel.slideUp(150));

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
        refreshWorldBookStat();
    }

    // Initial load
    refreshMode();
    refreshDecision();
    refreshStats();
    refreshDrawerBadges();
    refreshCardStatuses();
    refreshQuickActions();
    refreshPresetSelector();
    refreshWorldBookStat();

    // Refresh when any GD drawer is toggled
    $('.group-director-settings .inline-drawer-toggle').on('click', function () {
        setTimeout(refreshAll, 300);
    });

    // Auto-refresh when the GD settings panel is opened (ST drawer expands)
    const panelEl = document.getElementById('gd-settings-panel');
    if (panelEl) {
        const panelObserver = new MutationObserver(() => {
            if (!panelEl.classList.contains('closedDrawer')) {
                refreshAll();
            }
        });
        panelObserver.observe(panelEl, { attributes: true, attributeFilter: ['class'] });
    }

    // Expose refresh for other sections
    window.__gdRefreshDashboard = refreshAll;
});
