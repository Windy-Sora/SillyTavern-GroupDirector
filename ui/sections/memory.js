import { registerSection } from './registry.js';
import { DEFAULT_MEMORY_PROMPT, DEFAULT_MEMORY_SCHEMA, DEFAULT_MEMORY_RENDER } from '../../agents/memory.js';

registerSection('memory', function (ctx) {
    const { settings, $c, saveSettings, getCurrentGroup, toastr, memorySystem } = ctx;
    const getCharacters = () => window.characters || [];
    if (!memorySystem) return;
    const lang = settings.lang || 'zh';
    const L = (zh, en) => lang === 'zh' ? zh : en;

    const $section = $('#gd-memory-section');
    const $charSelect = $c('memory-char-select');
    const $stats = $c('memory-stats');
    const $list = $c('memory-list');

    // ── Bind values ──
    $c('memory-enabled').prop('checked', settings.memoryEnabled ?? false);
    $section.toggle(settings.memoryEnabled ?? false);
    $c('memory-token-budget').val(settings.memoryTokenBudget ?? 2000);
    $c('memory-prompt').val(settings.memoryPrompt || DEFAULT_MEMORY_PROMPT);
    $c('memory-json-schema').val(settings.memoryJsonSchema || DEFAULT_MEMORY_SCHEMA);
    $c('memory-render-template').val(settings.memoryRenderTemplate || DEFAULT_MEMORY_RENDER);
    $c('memory-keep-recent').val(settings.memoryKeepRecent ?? 5);

    // ── Events ──
    $c('memory-enabled').on('change', function () {
        settings.memoryEnabled = !!$(this).prop('checked');
        $section.toggle(settings.memoryEnabled);
        if (settings.memoryEnabled) refreshAll();
        saveSettings();
    });
    $c('memory-token-budget').on('input', function () { settings.memoryTokenBudget = Math.max(100, parseInt($(this).val()) || 2000); saveSettings(); });
    $c('memory-prompt').on('input', function () { settings.memoryPrompt = $(this).val(); saveSettings(); });
    $c('memory-json-schema').on('input', function () { settings.memoryJsonSchema = $(this).val(); saveSettings(); });
    $c('memory-render-template').on('input', function () { settings.memoryRenderTemplate = $(this).val(); saveSettings(); });
    $c('memory-keep-recent').on('input', function () { settings.memoryKeepRecent = Math.max(1, parseInt($(this).val()) || 5); saveSettings(); });
    $charSelect.on('change', () => renderMemoryList());

    // Reset buttons
    $c('memory-prompt-reset').on('click', () => { settings.memoryPrompt = ''; $c('memory-prompt').val(DEFAULT_MEMORY_PROMPT); saveSettings(); });
    $c('memory-schema-reset').on('click', () => { settings.memoryJsonSchema = ''; $c('memory-json-schema').val(DEFAULT_MEMORY_SCHEMA); saveSettings(); });
    $c('memory-render-reset').on('click', () => { settings.memoryRenderTemplate = ''; $c('memory-render-template').val(DEFAULT_MEMORY_RENDER); saveSettings(); });

    // Scan orphans
    $c('memory-detect-orphans').on('click', function () {
        const orphans = memorySystem.detectOrphans();
        if (!orphans.length) {
            toastr.info(L('所有记忆完好', 'All memories intact'));
            return;
        }
        const msg = orphans.map(o => L(`${o.name}: ${o.staleCount} 条失联`, `${o.name}: ${o.staleCount} orphaned`)).join('\n');
        toastr.warning(L('发现失联记忆:\n' + msg, 'Orphan memories detected:\n' + msg));
    });

    // Compress
    $c('memory-compress').on('click', async function () {
        const avatar = $charSelect.val();
        if (!avatar) { toastr.warning(L('请先选择角色', 'Select a character first')); return; }
        if (!confirm(L('压缩旧记忆？最近 N 条保留，其余合并为摘要。', 'Compress old memories? Recent entries kept, rest merged.'))) return;
        const result = await memorySystem.compressOldMemories(avatar, settings.memoryKeepRecent ?? 5);
        if (result) {
            toastr.success(L(`已压缩: ${result.removed} → ${result.compressed} 摘要 + ${result.kept} 保留`, `Compressed: ${result.removed} → ${result.compressed} summary + ${result.kept} kept`));
        } else {
            toastr.info(L('无需压缩', 'No compression needed'));
        }
        refreshAll();
    });

    // Refresh list from storage
    $c('memory-refresh').on('click', () => refreshAll());

    // Scan existing conversation for all characters
    $c('memory-scan').on('click', async function () {
        if (!confirm(L('扫描全量对话并提取记忆？将调用 LLM 处理。', 'Scan full conversation for all characters? Will call LLM.'))) return;
        const btn = $(this);
        btn.prop('disabled', true);
        try {
            const results = await memorySystem.generateForAll();
            const total = Object.values(results).filter(r => Array.isArray(r)).reduce((s, r) => s + r.length, 0);
            const errors = Object.values(results).filter(r => !Array.isArray(r)).length;
            toastr.success(L(`扫描完成: ${Object.keys(results).length} 个角色, ${total} 条记忆` + (errors ? `, ${errors} 失败` : ''),
                `Scan done: ${Object.keys(results).length} chars, ${total} entries` + (errors ? `, ${errors} failed` : '')));
            refreshAll();
        } catch (e) {
            toastr.error(L('扫描失败: ' + e.message, 'Scan failed: ' + e.message));
        } finally { btn.prop('disabled', false); }
    });

    // Generate for selected character
    $c('memory-generate').on('click', async function () {
        const avatar = $charSelect.val();
        if (!avatar) { toastr.warning(L('请先选择角色', 'Select a character first')); return; }
        if (!confirm(L('为选中角色提取新记忆？将调用 LLM 处理。', 'Extract new memories for selected character? Will call LLM.'))) return;
        const btn = $(this);
        btn.prop('disabled', true);
        try {
            const result = await memorySystem.generateForCharacter(avatar);
            toastr.success(L(`提取了 ${result.length} 条记忆`, `Extracted ${result.length} memories`));
            refreshAll();
        } catch (e) {
            toastr.error(L('提取失败: ' + e.message, 'Extraction failed: ' + e.message));
        } finally { btn.prop('disabled', false); }
    });

    // Generate for all
    $c('memory-generate-all').on('click', async function () {
        if (!confirm(L('为全部角色提取新记忆？将调用 LLM 处理。', 'Extract new memories for all characters? Will call LLM.'))) return;
        const btn = $(this);
        btn.prop('disabled', true);
        try {
            const results = await memorySystem.generateForAll();
            const total = Object.values(results).filter(r => Array.isArray(r)).reduce((s, r) => s + r.length, 0);
            const errors = Object.values(results).filter(r => !Array.isArray(r)).length;
            toastr.success(L(`为 ${Object.keys(results).length} 个角色提取了 ${total} 条记忆` + (errors ? `, ${errors} 失败` : ''),
                `Extracted ${total} memories for ${Object.keys(results).length} characters` + (errors ? `, ${errors} failed` : '')));
            refreshAll();
        } catch (e) {
            toastr.error(L('提取失败: ' + e.message, 'Extraction failed: ' + e.message));
        } finally { btn.prop('disabled', false); }
    });

    // Revert
    $c('memory-revert').on('click', async function () {
        const avatar = $charSelect.val();
        if (!avatar) { toastr.warning(L('请先选择角色', 'Select a character first')); return; }
        if (!confirm(L('回退最近一次提取？', 'Revert last extraction?'))) return;
        const removed = await memorySystem.revertLast(avatar, settings.memoryKeepRecent ?? 5);
        toastr.info(L(`已回退 ${removed.length} 条记忆`, `Reverted ${removed.length} entries`));
        refreshAll();
    });

    // Reset all
    $c('memory-reset').on('click', async function () {
        if (!confirm(L('重置所有角色的全部记忆？不可撤销！', 'Reset ALL memories for ALL characters? Undoable!'))) return;
        await memorySystem.resetAll();
        toastr.success(L('已重置', 'Reset complete'));
        refreshAll();
    });

    // ── Render helpers ──
    function refreshAll() {
        refreshCharSelect();
        renderMemoryList();
    }

    function refreshCharSelect() {
        const group = getCurrentGroup();
        const members = group?.members?.filter(a => !group.disabled_members?.includes(a)) ?? [];
        const stats = memorySystem.getStats();

        let html = '<option value="">' + L('全部角色', 'All characters') + '</option>';
        for (const avatar of members) {
            const c = getCharacters().find(ch => ch.avatar === avatar);
            const name = c?.name || avatar;
            const count = stats[avatar]?.count || 0;
            html += `<option value="${esc(avatar)}">${esc(name)} (${count} ${L('条', 'entries')})</option>`;
        }
        $charSelect.html(html);

        const total = memorySystem.totalCount();
        $stats.text(L(`共 ${total} 条记忆`, `${total} total entries`));
    }

    function renderMemoryList() {
        const avatar = $charSelect.val();
        if (!avatar) {
            // Show all
            const stats = memorySystem.getStats();
            let html = '';
            for (const [av, s] of Object.entries(stats)) {
                const mems = memorySystem.listMemories(av);
                if (!mems.length) continue;
                html += `<div style="margin-top:4px;"><b>${esc(s.name)} (${s.count})</b></div>`;
                html += mems.slice(-10).reverse().map((m, i) => {
                    const idx = mems.length - 10 + i;
                    return renderEntry(av, idx, m);
                }).join('');
            }
            if (!html) html = `<small style="color:var(--grey70a);">${L('暂无记忆，点击生成', 'No memories yet')}</small>`;
            $list.html(html);
        } else {
            const mems = memorySystem.listMemories(avatar);
            if (!mems.length) {
                $list.html(`<small style="color:var(--grey70a);">${L('暂无记忆，点击生成', 'No memories yet')}</small>`);
                return;
            }
            const html = [...mems].reverse().map((m, i) => renderEntry(avatar, mems.length - 1 - i, m)).join('');
            $list.html(html);
        }

        // Edit events
        $list.find('.gd-mem-edit-btn').off('click').on('click', function () {
            const avatar = $(this).attr('data-avatar');
            const idx = parseInt($(this).attr('data-idx'));
            if (isNaN(idx)) return;
            const mems = memorySystem.listMemories(avatar);
            const m = mems[idx];
            if (!m) return;
            $('#gd-mem-edit-idx').val(idx);
            $('#gd-mem-edit-avatar').val(avatar);
            $('#gd-mem-edit-event').val(m.event || '');
            $('#gd-mem-edit-mood').val(m.mood || 'neutral');
            $('#gd-mem-edit-panel').show();
        });

        // Delete events
        $list.find('.gd-mem-del-btn').off('click').on('click', async function () {
            const avatar = $(this).attr('data-avatar');
            const idx = parseInt($(this).attr('data-idx'));
            if (isNaN(idx)) return;
            if (!confirm(L('删除这条记忆？', 'Delete this memory?'))) return;
            await memorySystem.deleteEntry(avatar, idx);
            renderMemoryList();
        });
    }

    function renderEntry(avatar, idx, m) {
        return `<div style="font-size:0.82em;padding:2px 0;border-bottom:1px solid var(--SmartThemeBorderColor);display:flex;justify-content:space-between;align-items:flex-start;">
            <span>${esc(m.compressed ? '[压缩] ' : '')}${esc(m.event)} <span style="color:var(--grey70a);">[${esc(m.mood)}]</span></span>
            <span style="white-space:nowrap;display:flex;gap:2px;">
                <span class="menu_button menu_button_icon gd-mem-edit-btn" data-avatar="${avatar.replace(/"/g,'&quot;')}" data-idx="${idx}" style="font-size:0.75em;"><i class="fa-solid fa-pencil"></i></span>
                <span class="menu_button menu_button_icon gd-mem-del-btn" data-avatar="${avatar.replace(/"/g,'&quot;')}" data-idx="${idx}" style="font-size:0.75em;color:#ff5555;"><i class="fa-solid fa-trash"></i></span>
            </span>
        </div>`;
    }

    // Edit panel events
    $c('mem-edit-save').on('click', async function () {
        const avatar = $c('mem-edit-avatar').val();
        const idx = parseInt($c('mem-edit-idx').val());
        const event = $c('mem-edit-event').val().trim();
        if (!event) { toastr.warning(L('内容不能为空', 'Content required')); return; }
        await memorySystem.updateEntry(avatar, idx, { event, mood: $c('mem-edit-mood').val() });
        $('#gd-mem-edit-panel').hide();
        renderMemoryList();
    });
    $c('mem-edit-cancel').on('click', () => { $('#gd-mem-edit-panel').hide(); });

    function esc(s) {
        if (!s) return '';
        const div = document.createElement('div');
        div.textContent = String(s);
        return div.innerHTML;
    }

    refreshAll();
});
