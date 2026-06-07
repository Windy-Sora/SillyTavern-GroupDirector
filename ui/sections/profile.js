let saveSettings, settings, $c, getCurrentGroup, generateProfilesBatch, getProfiles, getDefaultProfileGeneratorPrompt,
    getDefaultProfileSchema, getDefaultProfileRenderTemplate, refreshProfileManagementUI, checkProfileStartupStatus,
    buildProfileLoaderPanel, detectCharacterChanges, validateAndWarnProfilePlaceholders, toastr;

export function initProfile(ctx) {
    saveSettings = ctx.saveSettings;
    settings = ctx.settings;
    $c = ctx.$c;
    getCurrentGroup = ctx.getCurrentGroup;
    generateProfilesBatch = ctx.generateProfilesBatch;
    getProfiles = ctx.getProfiles;
    getDefaultProfileGeneratorPrompt = ctx.getDefaultProfileGeneratorPrompt;
    getDefaultProfileSchema = ctx.getDefaultProfileSchema;
    getDefaultProfileRenderTemplate = ctx.getDefaultProfileRenderTemplate;
    refreshProfileManagementUI = ctx.refreshProfileManagementUI;
    checkProfileStartupStatus = ctx.checkProfileStartupStatus;
    buildProfileLoaderPanel = ctx.buildProfileLoaderPanel;
    detectCharacterChanges = ctx.detectCharacterChanges;
    validateAndWarnProfilePlaceholders = ctx.validateAndWarnProfilePlaceholders;
    toastr = ctx.toastr;

    $c('profile-enabled').prop('checked', settings.profileEnabled);
    $c('profile-token-budget').val(settings.profileTokenBudget);
    $c('profile-concurrency').val(settings.profileConcurrency);
    $c('profile-generator-prompt').val(settings.profileGeneratorPrompt || getDefaultProfileGeneratorPrompt());
    $c('profile-json-schema').val(settings.profileJsonSchema || getDefaultProfileSchema());
    $c('profile-render-template').val(settings.profileRenderTemplate || getDefaultProfileRenderTemplate());
    $('#gd-profile-section').toggle(settings.profileEnabled);

    $c('profile-enabled').on('input', function () {
        settings.profileEnabled = !!$(this).prop('checked');
        $('#gd-profile-section').toggle(settings.profileEnabled);
        if (settings.profileEnabled) {
            refreshProfileManagementUI();
            checkProfileStartupStatus();
        }
        saveSettings();
    });

    $c('profile-token-budget').on('input', function () {
        settings.profileTokenBudget = Math.max(1, parseInt($(this).val()) || 2000);
        saveSettings();
    });
    $c('profile-concurrency').on('input', function () {
        settings.profileConcurrency = Math.max(0, parseInt($(this).val()) || 0);
        saveSettings();
    });
    $c('profile-generator-prompt').on('input', function () { settings.profileGeneratorPrompt = $(this).val(); saveSettings(); });
    $c('profile-json-schema').on('input', function () { settings.profileJsonSchema = $(this).val(); saveSettings(); });
    $c('profile-render-template').on('input', function () {
        settings.profileRenderTemplate = $(this).val();
        validateAndWarnProfilePlaceholders('render');
        saveSettings();
    });

    $c('profile-generator-reset').on('click', function () {
        const def = getDefaultProfileGeneratorPrompt();
        $c('profile-generator-prompt').val(def);
        settings.profileGeneratorPrompt = '';
        saveSettings();
    });
    $c('profile-schema-reset').on('click', function () {
        const def = getDefaultProfileSchema();
        $c('profile-json-schema').val(def);
        settings.profileJsonSchema = '';
        saveSettings();
    });
    $c('profile-render-reset').on('click', function () {
        const def = getDefaultProfileRenderTemplate();
        $c('profile-render-template').val(def);
        settings.profileRenderTemplate = '';
        saveSettings();
    });

    $c('profile-scan-save').on('click', function () {
        const group = getCurrentGroup();
        if (!group) {
            toastr.warning(settings.lang === 'zh' ? '请先在群聊中打开此设置面板' : 'Please open this settings panel from within a group chat');
            return;
        }
        buildProfileLoaderPanel();
        toastr.info(settings.lang === 'zh' ? '已扫描存档' : 'Save scanned');
    });

    $c('profile-detect-changes').on('click', function () {
        const group = getCurrentGroup();
        if (!group) {
            toastr.warning(settings.lang === 'zh' ? '请先在群聊中打开此设置面板' : 'Please open this settings panel from within a group chat');
            return;
        }
        detectCharacterChanges();
    });

    $c('profile-regenerate-all').on('click', async function () {
        const group = getCurrentGroup();
        if (!group) {
            toastr.warning(settings.lang === 'zh' ? '请先在群聊中打开此设置面板' : 'Please open this settings panel from within a group chat');
            return;
        }
        const members = group.members.filter(a => !group.disabled_members?.includes(a));
        if (!members.length) {
            toastr.warning(settings.lang === 'zh' ? '当前群聊没有可用角色' : 'No enabled members in current group');
            return;
        }
        const btn = $('#gd-profile-regenerate-all');
        btn.prop('disabled', true);
        const lang = settings.lang || 'zh';
        toastr.info(lang === 'zh' ? `正在后台为 ${members.length} 个角色生成档案...` : `Generating profiles for ${members.length} characters in background...`);
        generateProfilesBatch(members).then(() => {
            const profiles = getProfiles();
            const ready = Object.values(profiles).filter(p => p.state === 'ready').length;
            const failed = Object.values(profiles).filter(p => p.state === 'failed').length;
            btn.prop('disabled', false);
            refreshProfileManagementUI();
            if (failed > 0) {
                toastr.warning(lang === 'zh'
                    ? `${ready} 个就绪, ${failed} 个失败 — 查看控制台了解详情`
                    : `${ready} ready, ${failed} failed — check console for details`);
            } else {
                toastr.success(lang === 'zh'
                    ? `${ready} 个角色档案已更新`
                    : `${ready} character profiles updated`);
            }
        }).catch(e => {
            btn.prop('disabled', false);
            toastr.error(lang === 'zh' ? '生成失败，请查看控制台' : 'Generation failed, check console');
            console.error('[GroupDirector] Batch profile generation failed:', e);
        });
    });

    // Initial render and status check
    refreshProfileManagementUI();
    checkProfileStartupStatus();
}