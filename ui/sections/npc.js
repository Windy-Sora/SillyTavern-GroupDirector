import { registerSection } from './registry.js';
import { DEFAULT_NPC_PROMPT } from '../../agents/npc.js';

registerSection('npc', function (ctx) {
    const { settings, $c, saveSettings, getCurrentGroup, toastr } = ctx;
    const lang = settings.lang || 'zh';
    const L = (zh, en) => lang === 'zh' ? zh : en;
    const npcSystem = ctx.npcSystem;
    if (!npcSystem) return;

    const $section = $('#gd-npc-section');
    const $toggle = $c('npc-enabled');
    const $generateBtn = $c('npc-generate');
    const $list = $c('npc-list');

    // ── Bind values ──
    $toggle.prop('checked', settings.npcEnabled ?? false);
    $section.toggle(settings.npcEnabled ?? false);
    $c('npc-max-count').val(settings.npcMaxCount ?? 10);
    $c('npc-batch-size').val(settings.npcBatchSize ?? 3);
    $c('npc-generate-firstmes').prop('checked', settings.npcGenerateFirstMes ?? false);
    $c('npc-prompt').val(settings.npcPrompt || DEFAULT_NPC_PROMPT);

    // ── Events ──
    $toggle.on('change', function () {
        settings.npcEnabled = !!$(this).prop('checked');
        $section.toggle(settings.npcEnabled);
        if (settings.npcEnabled) renderNpcList();
        saveSettings();
    });

    $c('npc-max-count').on('input', function () {
        settings.npcMaxCount = Math.max(1, parseInt($(this).val()) || 10);
        saveSettings();
    });

    $c('npc-batch-size').on('input', function () {
        settings.npcBatchSize = Math.max(1, Math.min(parseInt($(this).val()) || 3, settings.npcMaxCount || 10));
        saveSettings();
    });

    $c('npc-generate-firstmes').on('change', function () {
        settings.npcGenerateFirstMes = !!$(this).prop('checked');
        saveSettings();
    });

    $c('npc-prompt').on('input', function () {
        settings.npcPrompt = $(this).val();
        saveSettings();
    });

    $c('npc-prompt-reset').on('click', function () {
        settings.npcPrompt = '';
        $c('npc-prompt').val(DEFAULT_NPC_PROMPT);
        saveSettings();
        toastr.info(L('已恢复默认 Prompt', 'Prompt reset to default'));
    });

    $generateBtn.on('click', async function () {
        const btn = $(this);
        btn.prop('disabled', true);

        try {
            const result = await npcSystem.generateNpcs();
            if (result && result.length > 0) {
                toastr.success(L(`成功生成 ${result.length} 个 NPC`, `Generated ${result.length} NPCs`));
                renderNpcList();
            }
        } catch (e) {
            toastr.error(L('NPC 生成失败: ' + e.message, 'NPC generation failed: ' + e.message));
            console.error('[GroupDirector] NPC generation error:', e);
        } finally {
            btn.prop('disabled', false);
        }
    });

    // ── Render NPC list ──
    function renderNpcList() {
        const npcs = npcSystem.getNpcs();
        if (!npcs.length) {
            $list.html(`<small style="color:var(--grey70a);">${L('暂无 NPC，点击上方按钮生成', 'No NPCs yet. Click Generate above.')}</small>`);
            return;
        }

        let html = '';
        npcs.forEach((npc, i) => {
            const importedBadge = npc.imported
                ? `<span style="color:green;font-size:0.8em;">&#10003; ${L('已导入', 'Imported')} (${npc.importedAvatar || ''})</span>`
                : `<span class="menu_button menu_button_icon gd-npc-import" data-idx="${i}" style="font-size:0.8em;"><i class="fa-solid fa-user-plus"></i> ${L('导入为角色卡', 'Import as Card')}</span>`;

            const firstMesHtml = npc.first_mes
                ? `<div style="font-size:0.85em;margin-top:2px;"><b>First Mes:</b> ${esc(npc.first_mes).substring(0, 120)}</div>`
                : '';

            html += `
                <div class="gd-npc-card" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:6px;margin-bottom:4px;" data-idx="${i}">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <b>${esc(npc.name)}</b>
                        <div style="display:flex;gap:4px;align-items:center;">
                            ${importedBadge}
                            <span class="menu_button menu_button_icon gd-npc-delete" data-idx="${i}" style="font-size:0.75em;color:#ff5555;"><i class="fa-solid fa-trash"></i></span>
                        </div>
                    </div>
                    <div style="font-size:0.85em;color:var(--grey80a);margin-top:2px;">
                        ${esc(npc.description).substring(0, 150)}${npc.description.length > 150 ? '...' : ''}
                    </div>
                    <div style="font-size:0.8em;color:var(--grey70a);margin-top:2px;">
                        <b>${L('性格', 'Personality')}:</b> ${esc(npc.personality || '').substring(0, 80)}
                        &nbsp;|&nbsp; <b>${L('场景', 'Scenario')}:</b> ${esc(npc.scenario || '').substring(0, 80)}
                    </div>
                    ${firstMesHtml}
                </div>`;
        });

        $list.html(html);

        // Delete events
        $list.find('.gd-npc-delete').on('click', function () {
            const idx = parseInt($(this).data('idx'));
            if (confirm(L(`确定删除 NPC「${npcs[idx].name}」？`, `Delete NPC "${npcs[idx].name}"?`))) {
                npcSystem.deleteNpc(idx);
                renderNpcList();
            }
        });

        // Import events
        $list.find('.gd-npc-import').on('click', async function () {
            const idx = parseInt($(this).data('idx'));
            const btn = $(this);
            btn.prop('disabled', true);
            try {
                const avatarName = await npcSystem.importNpcAsCharacter(idx);
                toastr.success(L(`NPC「${npcs[idx].name}」已导入为角色卡: ${avatarName}`, `NPC "${npcs[idx].name}" imported as: ${avatarName}`));
                renderNpcList();
            } catch (e) {
                toastr.error(L('导入失败: ' + e.message, 'Import failed: ' + e.message));
                btn.prop('disabled', false);
            }
        });
    }

    function esc(s) {
        if (!s) return '';
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    // Initial render
    if (settings.npcEnabled) renderNpcList();
});
