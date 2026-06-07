import { applyModeVisibility } from '../i18n.js';

export function initModes(settings, $c, saveSettings) {
    $(`input[name="gd-mode"][value="${settings.mode}"]`).prop('checked', true);
    applyModeVisibility(settings.mode);

    $c('debug').prop('checked', settings.debugLogging);
    $c('debug').on('input', function () {
        settings.debugLogging = !!$(this).prop('checked');
        saveSettings();
    });

    $('input[name="gd-mode"]').on('change', function () {
        const newMode = $(this).val();
        settings.mode = newMode;
        applyModeVisibility(newMode);
        saveSettings();
    });
}