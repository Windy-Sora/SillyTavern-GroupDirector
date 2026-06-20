import { renderExtensionTemplateAsync } from '../../../../extensions.js';
import { doNavbarIconClick } from '../../../../../script.js';
import { applyI18n } from './i18n.js';
import { initAllSections } from './sections/registry.js';

// Side-effect imports: each section module self-registers on load
import './sections/modes.js';
import './sections/formula.js';
import './sections/director.js';
import './sections/continuity.js';
import './sections/worldinfo.js';
import './sections/worldBooks.js';
import './sections/ledger.js';
import './sections/forceSpeak.js';
import './sections/chatSummary.js';
import './sections/templateTester.js';
import './sections/profile.js';
import './sections/exportImport.js';
import './sections/npc.js';
import './sections/agents.js';

export async function loadSettingsUI(deps) {
    const { settings, EXT_KEY, chat_metadata, saveSettings } = deps;

    const html = await renderExtensionTemplateAsync('third-party/SillyTavern-GroupDirector', 'settings');

    // Create a top-level settings drawer at the same level as Extensions,
    // then render the Group Director settings inside it.
    const drawerId = 'gd-settings-button';
    const panelId = 'gd-settings-panel';
    const lang = settings.lang || 'zh';

    const drawerHtml = `
        <div id="${drawerId}" class="drawer" style="order:10;">
            <div class="drawer-toggle">
                <div class="drawer-icon fa-solid fa-globe fa-fw closedIcon"
                     title="${lang === 'zh' ? 'Group Director — 群聊导演' : 'Group Director'}"></div>
            </div>
            <div id="${panelId}" class="drawer-content closedDrawer"></div>
        </div>`;

    // Insert before Extensions (second-to-last) so the last slot
    // stays free for character cards as users expect.
    const $extButton = $('#extensions-settings-button');
    if ($extButton.length) {
        $extButton.before(drawerHtml);
        // Wire up the toggle — ST uses direct binding, so we must bind the
        // new drawer-toggle to the exported doNavbarIconClick handler.
        $(`#${drawerId} .drawer-toggle`).on('click', doNavbarIconClick);
    } else {
        // Fallback: if the sidebar isn't loaded yet, append to extensions panel
        $('#extensions_settings').append(html);
        console.warn('[GroupDirector] Could not find extensions drawer for top-level tab — falling back to inline');
        const $c = (sel) => $(`#gd-${sel}`);
        $c('lang').val(settings.lang);
        applyI18n(settings.lang, EXT_KEY, chat_metadata);
        $c('lang').on('change', function () {
            settings.lang = $(this).val();
            applyI18n(settings.lang, EXT_KEY, chat_metadata);
            saveSettings();
        });
        const ctx = { ...deps, $c };
        initAllSections(ctx);
        return;
    }

    // Render into the top-level drawer
    $(`#${panelId}`).append(html);

    const $c = (sel) => $(`#gd-${sel}`);

    // Language
    $c('lang').val(settings.lang);
    applyI18n(settings.lang, EXT_KEY, chat_metadata);
    $c('lang').on('change', function () {
        settings.lang = $(this).val();
        applyI18n(settings.lang, EXT_KEY, chat_metadata);
        saveSettings();
    });

    // Delegate to registered sections
    const ctx = { ...deps, $c };
    initAllSections(ctx);
}
