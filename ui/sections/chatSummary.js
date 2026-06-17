import { registerSection } from './registry.js';

registerSection('chatSummary', function (ctx) {
    const { settings, $c, saveSettings, summarySystem, toastr } = ctx;
    const ss = summarySystem;

    // Init
    $c('summary-enabled').prop('checked', !!settings.summaryEnabled);
    $c('summary-reuse').prop('checked', settings.summaryReusePrevious !== false);
    $c('summary-prompt').val(settings.summaryPrompt || '');

    const checkEnabled = () => {
        const on = !!settings.summaryEnabled;
        $c('summary-reuse').prop('disabled', !on);
        $c('summary-prompt').prop('disabled', !on);
        $c('summary-execute').prop('disabled', !on);
        $c('summary-regenerate').prop('disabled', !on);
        $c('summary-revert').prop('disabled', !on);
        $c('summary-reset').prop('disabled', !on);
        $c('summary-prompt-reset').prop('disabled', !on);
    };
    checkEnabled();

    // Toggle
    $c('summary-enabled').on('change', () => {
        settings.summaryEnabled = !!$c('summary-enabled').prop('checked');
        checkEnabled();
        saveSettings();
    });

    // Reuse toggle
    $c('summary-reuse').on('change', () => {
        settings.summaryReusePrevious = !!$c('summary-reuse').prop('checked');
        saveSettings();
    });

    // Prompt
    $c('summary-prompt').on('input', () => {
        settings.summaryPrompt = $c('summary-prompt').val();
        saveSettings();
    });
    $c('summary-prompt-reset').on('click', () => {
        $c('summary-prompt').val('');
        settings.summaryPrompt = '';
        saveSettings();
        toastr.info(settings.lang === 'zh' ? '已恢复默认总结 Prompt' : 'Summary prompt reset to default');
    });

    // Execute
    $c('summary-execute').on('click', async () => {
        $c('summary-execute').prop('disabled', true);
        try {
            const entry = await ss.generateSummary();
            refreshStatus();
            toastr.success(settings.lang === 'zh'
                ? `总结完成，覆盖 ${entry.rangeEnd} 条消息`
                : `Summary complete, covers ${entry.rangeEnd} messages`);
        } catch (e) {
            toastr.error(e.message || (settings.lang === 'zh' ? '总结失败' : 'Summary failed'));
        }
        $c('summary-execute').prop('disabled', false);
    });

    // Regenerate
    $c('summary-regenerate').on('click', async () => {
        $c('summary-regenerate').prop('disabled', true);
        try {
            await ss.regenerateLastSummary();
            refreshStatus();
            toastr.success(settings.lang === 'zh' ? '已重新总结' : 'Regenerated summary');
        } catch (e) {
            toastr.error(e.message || (settings.lang === 'zh' ? '重新总结失败' : 'Regenerate failed'));
        }
        $c('summary-regenerate').prop('disabled', false);
    });

    // Revert
    $c('summary-revert').on('click', async () => {
        if (!confirm(settings.lang === 'zh' ? '回退最新总结，恢复原文片段？' : 'Revert latest summary, restore original text?')) return;
        await ss.revertLastSummary();
        refreshStatus();
        toastr.info(settings.lang === 'zh' ? '已回退总结' : 'Summary reverted');
    });

    // Reset
    $c('summary-reset').on('click', async () => {
        if (!confirm(settings.lang === 'zh' ? '关闭所有总结，恢复全部原文？' : 'Deactivate all summaries, restore full original text?')) return;
        await ss.resetAll();
        refreshStatus();
        toastr.info(settings.lang === 'zh' ? '已重置全部总结' : 'All summaries reset');
    });

    function refreshStatus() {
        const active = ss.getLatestActive();
        if (active) {
            $c('summary-status').text((settings.lang === 'zh'
                ? `已激活：覆盖前 ${active.rangeEnd} 条消息`
                : `Active: covers first ${active.rangeEnd} messages`) + (active.basedOn !== null ? (settings.lang === 'zh' ? '（基于上一条总结）' : ' (based on previous)') : ''));
        } else {
            $c('summary-status').text(settings.lang === 'zh' ? '无活跃总结' : 'No active summary');
        }
    }
    refreshStatus();
});
