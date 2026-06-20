import { registerSection } from './registry.js';

registerSection('executionTrace', function (ctx) {
    const { settings, $c, saveSettings, AgentTrace } = ctx;
    if (!AgentTrace) return;
    const lang = settings.lang || 'zh';
    const L = (zh, en) => lang === 'zh' ? zh : en;

    const $list = $('#gd-trace-list');
    if (!$list.length) return;

    // ── Max entries ──
    AgentTrace.setMax(settings.traceMaxEntries ?? 50);
    $c('trace-max').val(settings.traceMaxEntries ?? 50);
    $c('trace-max').on('input', function () {
        settings.traceMaxEntries = Math.max(1, parseInt($(this).val()) || 50);
        AgentTrace.setMax(settings.traceMaxEntries);
        saveSettings();
    });

    // ── Render ──
    function render() {
        const traces = AgentTrace.recent();
        if (!traces.length) {
            $list.html(`<small style="color:var(--grey70a);">${L('暂无执行记录。开启 debugLogging 后自动采集。', 'No traces yet. Enable debugLogging to collect.')}</small>`);
            return;
        }

        let html = '';
        // Show newest first
        for (let i = traces.length - 1; i >= 0; i--) {
            const t = traces[i];
            const hasError = t.stages.some(s => s.error);
            const icon = hasError ? '✗' : '✓';
            const color = hasError ? '#ff5555' : 'var(--green)';
            const totalMs = t.stages.reduce((sum, s) => sum + (s.duration || 0), 0).toFixed(0);
            const stageSummary = t.stages.filter(s => s.stage !== '_start' && s.stage !== '_done').map(s => s.stage).join(' → ');

            html += `
                <div class="gd-trace-card" style="border:1px solid var(--SmartThemeBorderColor);border-radius:4px;padding:6px;margin-bottom:4px;">
                    <div class="gd-trace-header" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
                        <span>
                            <b style="color:${color}">${icon}</b>
                            <b>${esc(t.agentId)}</b>
                            <span style="font-size:0.85em;color:var(--grey70a);margin-left:4px;">${esc(t.startTime?.substring(11, 19) || '')}</span>
                        </span>
                        <span style="font-size:0.85em;color:var(--grey70a);">
                            ${t.stages.length - 2} ${L('阶段', 'stages')} | ${totalMs}ms | ${stageSummary}
                            <i class="fa-solid fa-chevron-down gd-trace-arrow" data-idx="${i}"></i>
                        </span>
                    </div>
                    <div class="gd-trace-detail" data-idx="${i}" style="display:none;margin-top:6px;border-top:1px solid var(--SmartThemeBorderColor);padding-top:4px;">
                        ${t.stages.filter(s => s.stage !== '_start').map(s => renderStage(s)).join('')}
                    </div>
                </div>`;
        }

        $list.html(html);

        // Toggle expand
        $list.find('.gd-trace-header').on('click', function () {
            const detail = $(this).siblings('.gd-trace-detail');
            const arrow = $(this).find('.gd-trace-arrow');
            detail.toggle();
            arrow.toggleClass('fa-chevron-down fa-chevron-up');
        });
    }

    function renderStage(s) {
        const dur = s.duration != null ? `${s.duration.toFixed(0)}ms` : '';
        let meta = '';
        if (s.retries > 0) meta += ` ${L('重试', 'retries')}: ${s.retries}`;
        if (s.promptLength) meta += ` ${L('prompt长度', 'prompt')}: ${s.promptLength}chars`;
        if (s.error) meta += ` <span style="color:#ff5555;">${esc(s.error)}</span>`;
        if (s.outputSummary) {
            const o = s.outputSummary;
            if (o.type === 'text') meta += ` ${L('输出', 'out')}: ${o.length}chars`;
            if (o.type === 'object') meta += ` ${L('输出', 'out')}: {${o.keys?.join(', ')}}`;
            if (o.type === 'array') meta += ` ${L('输出', 'out')}: [${o.length}]`;
        }

        return `<div style="font-size:0.82em;padding:2px 0;display:flex;justify-content:space-between;">
            <span><b>${esc(s.stage)}</b></span>
            <span style="color:var(--grey70a);">${dur}${meta}</span>
        </div>`;
    }

    function esc(s) {
        if (!s) return '';
        const div = document.createElement('div');
        div.textContent = String(s);
        return div.innerHTML;
    }

    // ── Events ──
    $('#gd-trace-refresh').on('click', render);
    $('#gd-trace-clear').on('click', () => { AgentTrace.clear(); render(); });

    render();
});
