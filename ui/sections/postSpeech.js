import { registerSection } from './registry.js';
import { DEFAULT_PROMPT } from '../../agents/post-speech.js';

registerSection('postSpeech', function (ctx) {
    const { settings, $c, saveSettings, CapabilityRegistry, toastr } = ctx;
    const lang = settings.lang || 'zh';
    const L = (zh, en) => lang === 'zh' ? zh : en;

    const $capsList = $('#gd-ps-capabilities-list');

    // ── Per-message ──
    const $msgSection = $('#gd-ps-msg-section');
    $c('ps-msg-enabled').prop('checked', settings.postSpeechMessageEnabled ?? false);
    $msgSection.toggle(settings.postSpeechMessageEnabled ?? false);
    $c('ps-msg-prompt').val(settings.postSpeechMessagePrompt || DEFAULT_PROMPT);

    $c('ps-msg-enabled').on('change', function () {
        settings.postSpeechMessageEnabled = !!$(this).prop('checked');
        $msgSection.toggle(settings.postSpeechMessageEnabled);
        saveSettings();
    });
    $c('ps-msg-prompt').on('input', function () {
        settings.postSpeechMessagePrompt = $(this).val();
        saveSettings();
    });
    $c('ps-msg-prompt-reset').on('click', function () {
        settings.postSpeechMessagePrompt = '';
        $c('ps-msg-prompt').val(DEFAULT_PROMPT);
        saveSettings();
        toastr.info(L('已恢复默认 Prompt', 'Prompt reset to default'));
    });

    // ── Per-round ──
    const $roundSection = $('#gd-ps-round-section');
    $c('ps-round-enabled').prop('checked', settings.postSpeechRoundEnabled ?? false);
    $roundSection.toggle(settings.postSpeechRoundEnabled ?? false);
    $c('ps-round-prompt').val(settings.postSpeechRoundPrompt || DEFAULT_PROMPT);

    $c('ps-round-enabled').on('change', function () {
        settings.postSpeechRoundEnabled = !!$(this).prop('checked');
        $roundSection.toggle(settings.postSpeechRoundEnabled);
        saveSettings();
    });
    $c('ps-round-prompt').on('input', function () {
        settings.postSpeechRoundPrompt = $(this).val();
        saveSettings();
    });
    $c('ps-round-prompt-reset').on('click', function () {
        settings.postSpeechRoundPrompt = '';
        $c('ps-round-prompt').val(DEFAULT_PROMPT);
        saveSettings();
        toastr.info(L('已恢复默认 Prompt', 'Prompt reset to default'));
    });

    // ── Blocking ──
    $c('ps-blocking').prop('checked', settings.postSpeechBlocking !== false);
    $c('ps-blocking').on('change', function () {
        settings.postSpeechBlocking = !!$(this).prop('checked');
        saveSettings();
    });

    // ── Decision limit ──
    $c('ps-decision-limit').val(settings.postSpeechDecisionLimit ?? 20);
    $c('ps-decision-limit').on('input', function () {
        settings.postSpeechDecisionLimit = Math.max(1, parseInt($(this).val()) || 20);
        saveSettings();
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

    $('#gd-cap-refresh').on('click', renderCapabilities);
    renderCapabilities();
});
