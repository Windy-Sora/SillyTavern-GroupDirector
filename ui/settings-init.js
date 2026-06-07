import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { applyI18n } from './i18n.js';
import { initModes } from './sections/modes.js';
import { initFormula } from './sections/formula.js';
import { initDirector } from './sections/director.js';
import { initContinuity } from './sections/continuity.js';
import { initWorldInfo } from './sections/worldinfo.js';
import { initProfile } from './sections/profile.js';

export async function loadSettingsUI(deps) {
    const { settings, EXT_KEY, chat_metadata, saveChatConditional, saveSettings, getCurrentGroup,
        getDefaultLlmPrompt, generateProfilesBatch, getProfiles, getDefaultProfileGeneratorPrompt,
        getDefaultProfileSchema, getDefaultProfileRenderTemplate, refreshProfileManagementUI,
        checkProfileStartupStatus, buildProfileLoaderPanel, detectCharacterChanges,
        validateAndWarnProfilePlaceholders, toastr } = deps;

    const html = await renderExtensionTemplateAsync('third-party/SillyTavern-GroupDirector', 'settings');
    $('#extensions_settings').append(html);

    const $c = (sel) => $(`#gd-${sel}`);

    // Language
    $c('lang').val(settings.lang);
    applyI18n(settings.lang, EXT_KEY, chat_metadata);
    $c('lang').on('change', function () {
        settings.lang = $(this).val();
        applyI18n(settings.lang, EXT_KEY, chat_metadata);
        saveSettings();
    });

    // Mode select
    initModes(settings, $c, saveSettings);

    // Formula section
    initFormula(settings, $c, saveSettings);

    // Director / Script / History
    const ctx = { settings, EXT_KEY, chat_metadata, saveChatConditional, saveSettings, $c, getDefaultLlmPrompt };
    initDirector(ctx);

    // Continuity
    initContinuity(ctx);

    // World Info
    initWorldInfo(ctx);

    // Profile System
    const profileCtx = {
        settings, saveSettings, $c, getCurrentGroup, generateProfilesBatch, getProfiles,
        getDefaultProfileGeneratorPrompt, getDefaultProfileSchema, getDefaultProfileRenderTemplate,
        refreshProfileManagementUI, checkProfileStartupStatus, buildProfileLoaderPanel,
        detectCharacterChanges, validateAndWarnProfilePlaceholders, toastr,
    };
    initProfile(profileCtx);
}