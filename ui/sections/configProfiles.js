import { registerSection } from './registry.js';

registerSection('configProfiles', function (ctx) {
    const { settings, $c, saveSettings, toastr, configProfileSystem, getConfigPresetNames, loadConfigPreset } = ctx;
    if (!configProfileSystem) return;

    const sys = configProfileSystem;
    const isZh = () => (settings.lang || 'zh') === 'zh';

    // ── Drawer checkboxes state ──────────────────────────────────────

    const drawerDefaults = {
        directorLlm: true,
        worldBooks: true,
        profilesAndData: true,
        contextLedger: true,
        multimodal: false,
        assetManager: false,
        agentsTools: true,
    };

    function getDrawerSelection() {
        const sel = {};
        for (const k of Object.keys(drawerDefaults)) {
            sel[k] = $c(`cfg-drawer-${k}`).prop('checked') || false;
        }
        return sel;
    }

    // ── Render profile list ──────────────────────────────────────────

    function renderList() {
        const $list = $('#gd-config-profiles-list');
        if (!$list.length) return;

        const profiles = sys.getProfiles();
        if (!profiles.length) {
            $list.html(`<small style="color:var(--grey70a);">${isZh() ? '暂无配置档，点击"保存当前为配置档"创建' : 'No config profiles. Click "Save current as profile" to create one.'}</small>`);
            return;
        }

        let html = '';
        profiles.forEach(p => {
            const dateStr = new Date(p.createdAt).toLocaleString();
            const drawerCount = Object.values(p.drawers).filter(Boolean).length;
            html += `<div class="gd-config-profile-card" data-id="${escAttr(p.id)}" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:8px;margin-top:6px;">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <div style="flex:1;min-width:0;">
                        <b>${escHtml(p.name)}</b>
                        <small style="color:var(--grey70a);display:block;">${escHtml(p.description || '')}</small>
                        <small style="color:var(--grey70a);font-size:0.75em;">${dateStr} · ${drawerCount} ${isZh() ? '个抽屉' : 'drawers'}</small>
                    </div>
                    <div style="display:flex;gap:4px;flex-shrink:0;margin-left:8px;">
                        <span class="menu_button menu_button_icon gd-cfg-apply-btn" data-id="${escAttr(p.id)}" style="font-size:0.8em;color:#4caf50;">
                            <i class="fa-solid fa-check"></i> ${isZh() ? '应用' : 'Apply'}
                        </span>
                        <span class="menu_button menu_button_icon gd-cfg-export-btn" data-id="${escAttr(p.id)}" style="font-size:0.8em;">
                            <i class="fa-solid fa-file-zipper"></i> ${isZh() ? '导出' : 'Export'}
                        </span>
                        <span class="menu_button menu_button_icon gd-cfg-delete-btn" data-id="${escAttr(p.id)}" style="font-size:0.75em;color:#ff5555;">
                            <i class="fa-solid fa-trash"></i>
                        </span>
                    </div>
                </div>
            </div>`;
        });
        $list.html(html);

        // Apply
        $list.find('.gd-cfg-apply-btn').off('click').on('click', function () {
            const id = $(this).data('id');
            const profile = sys.getProfiles().find(p => p.id === id);
            if (!profile) return;
            if (!confirm(isZh()
                ? `应用配置档「${profile.name}」？当前设置将被覆盖。`
                : `Apply config profile "${profile.name}"? Current settings will be overwritten.`)) return;

            // Check for customPrompt conflicts before applying
            const incoming = profile.settings?.customPrompts;
            let mergeMode = 'replace';
            if (incoming && Array.isArray(incoming) && incoming.length > 0) {
                const existing = (settings.customPrompts || []);
                const existingNames = new Set(existing.map(e => e.name));
                const conflicts = incoming.filter(e => existingNames.has(e.name)).map(e => e.name);
                if (conflicts.length > 0) {
                    const msg = isZh()
                        ? `检测到 ${conflicts.length} 个同名自定义 Prompt：${conflicts.join(', ')}。\n\n点"确定"保留现有（仅添加不同名的），点"取消"跳过全部自定义 Prompt 导入。`
                        : `Found ${conflicts.length} custom prompt(s) with same name: ${conflicts.join(', ')}.\n\nOK = keep existing + add only different names. Cancel = skip all custom prompts.`;
                    const choice = confirm(msg);
                    if (!choice) {
                        mergeMode = 'skip';
                    }
                    // 'replace' mode keeps existing same-names, adds different-names
                }
            }

            const result = sys.applyProfile(id, mergeMode);
            let msg = isZh()
                ? `已应用「${profile.name}」，${result.changed.length} 项设置已更新。`
                : `Applied "${profile.name}", ${result.changed.length} setting(s) updated.`;
            if (result.customPromptConflicts?.length > 0) {
                msg += isZh()
                    ? ` ${result.customPromptConflicts.length} 个同名 Prompt 已保留现有。`
                    : ` ${result.customPromptConflicts.length} same-name prompt(s) kept existing.`;
            }
            if (mergeMode === 'skip') {
                msg += isZh() ? ' 自定义 Prompt 未导入。' : ' Custom prompts not imported.';
            }
            toastr.success(msg + (isZh() ? ' 请刷新页面以完全生效。' : ' Refresh the page for full effect.'));
        });

        // Export
        $list.find('.gd-cfg-export-btn').off('click').on('click', async function () {
            const id = $(this).data('id');
            const btn = $(this); btn.prop('disabled', true);
            try {
                await sys.exportProfileAsZip(id);
                toastr.success(isZh() ? '配置档已导出为 .zip' : 'Config profile exported as .zip');
            } catch (e) {
                toastr.error((isZh() ? '导出失败: ' : 'Export failed: ') + e.message);
            } finally { btn.prop('disabled', false); }
        });

        // Delete
        $list.find('.gd-cfg-delete-btn').off('click').on('click', function () {
            const id = $(this).data('id');
            const profile = sys.getProfiles().find(p => p.id === id);
            if (!profile) return;
            if (!confirm(isZh() ? `删除配置档「${profile.name}」？` : `Delete config profile "${profile.name}"?`)) return;
            sys.deleteProfile(id);
            renderList();
            toastr.info(isZh() ? '已删除' : 'Deleted');
        });
    }

    // ── Save current ─────────────────────────────────────────────────

    $c('cfg-save-btn').off('click').on('click', function () {
        const name = $c('cfg-save-name').val().trim();
        if (!name) {
            toastr.warning(isZh() ? '请输入配置档名称' : 'Enter a profile name');
            return;
        }
        const desc = $c('cfg-save-desc').val().trim();
        const drawers = getDrawerSelection();
        if (!Object.values(drawers).some(Boolean)) {
            toastr.warning(isZh() ? '请至少选择一个抽屉' : 'Select at least one drawer');
            return;
        }
        sys.saveCurrentAsProfile(name, desc, drawers);
        $c('cfg-save-name').val('');
        $c('cfg-save-desc').val('');
        renderList();
        toastr.success(isZh() ? `配置档「${name}」已保存` : `Config profile "${name}" saved`);
    });

    // ── Import .zip ──────────────────────────────────────────────────

    $c('cfg-import-file').off('change').on('change', async function () {
        const file = this.files[0];
        if (!file) return;
        const btn = $c('cfg-import-btn'); btn.prop('disabled', true);
        try {
            const profile = await sys.importProfileFromZip(file);
            renderList();
            toastr.success(isZh() ? `已导入配置档「${profile.name}」` : `Config profile "${profile.name}" imported`);
        } catch (e) {
            toastr.error((isZh() ? '导入失败: ' : 'Import failed: ') + e.message);
        } finally { btn.prop('disabled', false); this.value = ''; }
    });

    $c('cfg-import-btn').off('click').on('click', () => $('#gd-cfg-import-file').click());

    // ── Preset dropdown ───────────────────────────────────────────────

    const presetNames = getConfigPresetNames();
    if (presetNames.length) {
        const $sel = $c('cfg-preset');
        presetNames.forEach(name => {
            if ($sel.find(`option[value="${escAttr(name)}"]`).length === 0) {
                $sel.append(`<option value="${escAttr(name)}">${escHtml(name)}</option>`);
            }
        });
    }

    $c('cfg-preset').off('change').on('change', async function () {
        const name = $(this).val();
        if (!name) return;
        const btn = $(this); btn.prop('disabled', true);
        try {
            const profile = await loadConfigPreset(name);
            renderList();
            toastr.success(isZh() ? `已加载预设「${profile.name}」` : `Preset "${profile.name}" loaded`);
        } catch (e) {
            toastr.error((isZh() ? '加载预设失败: ' : 'Preset load failed: ') + e.message);
        } finally { btn.prop('disabled', false); $(this).val(''); }
    });

    // ── Initial ──────────────────────────────────────────────────────

    renderList();
});

function escHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}
