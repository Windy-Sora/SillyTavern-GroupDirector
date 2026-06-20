import { registerSection } from './registry.js';
import { DEFAULT_PROMPT } from '../../agents/post-speech.js';

registerSection('postSpeech', function (ctx) {
    const { settings, $c, saveSettings, CapabilityRegistry, toastr, renderPrompt } = ctx;
    const lang = settings.lang || 'zh';
    const L = (zh, en) => lang === 'zh' ? zh : en;

    const $section = $('#gd-ps-section');
    const $capsList = $('#gd-ps-capabilities-list');

    // ── Bind values ──
    $c('ps-enabled').prop('checked', settings.postSpeechEnabled ?? false);
    $section.toggle(settings.postSpeechEnabled ?? false);
    $c('ps-blocking').prop('checked', settings.postSpeechBlocking !== false);
    $c('ps-prompt').val(settings.postSpeechPrompt || DEFAULT_PROMPT);

    // ── Events ──
    $c('ps-enabled').on('change', function () {
        settings.postSpeechEnabled = !!$(this).prop('checked');
        $section.toggle(settings.postSpeechEnabled);
        saveSettings();
    });

    $c('ps-blocking').on('change', function () {
        settings.postSpeechBlocking = !!$(this).prop('checked');
        saveSettings();
    });

    $c('ps-prompt').on('input', function () {
        settings.postSpeechPrompt = $(this).val();
        saveSettings();
    });

    $c('ps-prompt-reset').on('click', function () {
        settings.postSpeechPrompt = '';
        $c('ps-prompt').val(DEFAULT_PROMPT);
        saveSettings();
        toastr.info(L('已恢复默认 Prompt', 'Prompt reset to default'));
    });

    // ── Capability list ──
    function renderCapabilities() {
        if (!$capsList.length || !CapabilityRegistry) return;
        const caps = CapabilityRegistry.list();
        if (!caps.length) {
            $capsList.html(`<small style="color:var(--grey70a);">${L('暂无注册能力', 'No capabilities registered')}</small>`);
            return;
        }
        let html = '';
        caps.forEach(cap => {
            html += `
                <div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid var(--SmartThemeBorderColor);">
                    <input type="checkbox" class="gd-cap-enabled" data-cap="${cap.id}" ${cap.enabled ? 'checked' : ''}>
                    <b>${esc(cap.displayName || cap.id)}</b>
                    <span style="font-size:0.8em;color:var(--grey70a);">${esc(cap.description || '')}</span>
                </div>`;
        });
        $capsList.html(html);

        // Enable/disable
        $capsList.find('.gd-cap-enabled').on('change', function () {
            const capId = $(this).data('cap');
            const enabled = !!$(this).prop('checked');
            if (CapabilityRegistry) CapabilityRegistry.setEnabled(capId, enabled);
        });
    }

    function esc(s) {
        if (!s) return '';
        const div = document.createElement('div');
        div.textContent = String(s);
        return div.innerHTML;
    }

    renderCapabilities();

    // ── Template tester hook: inject capability list into test render ──
    // When user clicks test render, populate a capability list context
    // so {{capabilityList}} resolves in the tester.
    const origTesterRun = $c('tester-run').data('handler');
});
