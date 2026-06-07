import { toggleCharDescLength } from '../i18n.js';

let saveSettings, settings, $c, chat_metadata, EXT_KEY, saveChatConditional;

export function initDirector(ctx) {
    saveSettings = ctx.saveSettings;
    settings = ctx.settings;
    $c = ctx.$c;
    chat_metadata = ctx.chat_metadata;
    EXT_KEY = ctx.EXT_KEY;
    saveChatConditional = ctx.saveChatConditional;

    $c('llm-prompt').val(settings.llmPrompt || ctx.getDefaultLlmPrompt());
    $c('llm-max-speakers').val(settings.llmMaxSpeakers);
    $c('llm-context-depth').val(settings.llmContextDepth);
    $c('llm-respect-order').prop('checked', settings.llmRespectOrder);
    $(`input[name="gd-llm-char-desc-mode"][value="${settings.llmCharDescMode}"]`).prop('checked', true);
    $c('llm-char-desc-length').val(settings.llmCharDescLength);
    $c('llm-script-enabled').prop('checked', settings.llmScriptEnabled);
    $c('llm-script-prompt').val(settings.llmScriptPrompt);
    $c('llm-script-wrapper').val(settings.llmScriptWrapper);

    toggleCharDescLength(settings.llmCharDescMode);

    $c('llm-prompt').on('input', function () { settings.llmPrompt = $(this).val(); saveSettings(); });
    $c('llm-max-speakers').on('input', function () {
        settings.llmMaxSpeakers = Math.max(1, parseInt($(this).val()) || 3);
        saveSettings();
    });
    $c('llm-context-depth').on('input', function () {
        settings.llmContextDepth = Math.max(1, parseInt($(this).val()) || 10);
        saveSettings();
    });
    $c('llm-respect-order').on('input', function () { settings.llmRespectOrder = !!$(this).prop('checked'); saveSettings(); });
    $('input[name="gd-llm-char-desc-mode"]').on('change', function () {
        settings.llmCharDescMode = $(this).val();
        toggleCharDescLength(settings.llmCharDescMode);
        saveSettings();
    });
    $c('llm-char-desc-length').on('input', function () {
        settings.llmCharDescLength = Math.max(1, parseInt($(this).val()) || 200);
        saveSettings();
    });
    $c('llm-script-enabled').on('input', function () { settings.llmScriptEnabled = !!$(this).prop('checked'); saveSettings(); });
    $c('llm-script-prompt').on('input', function () {
        settings.llmScriptPrompt = $(this).val();
        const val = $(this).val();
        if (val) {
            $('#gd-history-meta-script').text(val);
            $('#gd-history-meta-display').show();
        }
        saveSettings();
    });
    $c('llm-script-wrapper').on('input', function () { settings.llmScriptWrapper = $(this).val(); saveSettings(); });

    // History (ledger) buttons
    $c('llm-history-enabled').prop('checked', settings.llmHistoryEnabled);
    $c('llm-history-enabled').on('input', function () { settings.llmHistoryEnabled = !!$(this).prop('checked'); saveSettings(); });

    const persistedScript = chat_metadata?.[EXT_KEY]?.historyMeta?.scriptPrompt;
    if (persistedScript) {
        $('#gd-history-meta-script').text(persistedScript);
        $('#gd-history-meta-display').show();
    }

    $c('llm-history-clear').on('click', function () {
        if (chat_metadata[EXT_KEY]) {
            chat_metadata[EXT_KEY].directorHistory = [];
            if (chat_metadata[EXT_KEY].historyMeta) {
                chat_metadata[EXT_KEY].historyMeta.scriptPrompt = '';
            }
        }
        $('#gd-history-meta-display').hide();
        saveChatConditional();
        toastr.info('导演账本已清空');
    });

    $c('llm-prompt-reset').on('click', function () {
        const def = ctx.getDefaultLlmPrompt();
        $c('llm-prompt').val(def);
        settings.llmPrompt = def;
        saveSettings();
    });
}