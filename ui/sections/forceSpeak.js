import { registerSection } from './registry.js';

registerSection('forceSpeak', function (ctx) {
    const { settings, $c, saveSettings, toastr } = ctx;

    $(`input[name="gd-force-speak-mode"][value="${settings.forceSpeakMode || 'native'}"]`).prop('checked', true);
    $('#gd-force-speak-llm-section').toggle(settings.forceSpeakMode === 'llm');

    $('input[name="gd-force-speak-mode"]').on('change', function () {
        settings.forceSpeakMode = $(this).val();
        $('#gd-force-speak-llm-section').toggle(settings.forceSpeakMode === 'llm');
        saveSettings();
    });

    $c('force-speak-prompt').val(settings.forceSpeakPrompt || '');
    $c('force-speak-prompt').on('input', () => {
        settings.forceSpeakPrompt = $c('force-speak-prompt').val();
        saveSettings();
    });
    $c('force-speak-prompt-reset').on('click', () => {
        $c('force-speak-prompt').val('');
        settings.forceSpeakPrompt = '';
        saveSettings();
        toastr.info(settings.lang === 'zh' ? '已恢复默认强制发言 Prompt' : 'Force-speak prompt reset to default');
    });
});
