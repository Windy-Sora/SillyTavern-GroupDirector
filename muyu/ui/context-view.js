import { CONTEXT_DEFAULTS, MAX_MANUAL_INPUT_TOKENS } from '../context/policy.js';
import { formatBudget } from './budget-view.js';
import { permissionTitle } from '../permissions/contract.js';

/** View only. Summary text is plain reference data; no operation comes from model output. */
export function createContextView({ doc, settings, parent, controller, act, lang }) {
    const t = (zh, en) => lang === 'en' ? en : zh;
    const node = (tag, text, owner) => { const el = doc.createElement(tag); el.textContent = text; owner.append(el); return el; };
    const button = (text, owner) => { const el = node('button', text, owner); el.type = 'button'; el.className = 'menu_button'; return el; };
    const field = (text, type, owner) => { const label = node('label', text, owner), el = node('input', '', label); el.type = type; el.className = type === 'checkbox' ? '' : 'text_pole'; return el; };
    const config = node('details', '', settings); node('summary', t('上下文预算', 'Context budget'), config);
    config.open = true;
    node('p', t('面向 1M 上下文模型，默认输入预算为 900000 估算 Token，留出输出与估算余量；历史另预留 10% 给问题、指令和工具。旧版默认小预算自动升级，自定义组合保留；重新保存的手动预算始终保留。估算不是模型窗口，较小模型请降低预算；增大预算可能增加费用。', 'For 1M-context models: default input budget is 900000 estimated tokens, leaving room for output and estimation error. History additionally reserves 10% for the question, instructions and tools. Legacy defaults upgrade; custom combinations and explicitly re-saved budgets stay unchanged. Estimates are not model windows; lower this for smaller models. Larger budgets may cost more.'), config);
    const autoBudget = field(t('仅按请求体保护（8 MiB；不限制估算 Token）', 'Request-size protection only (8 MiB; no token cap)'), 'checkbox', config);
    const tokens = field(t('手动输入预算（估算 Token）', 'Manual input budget (estimated tokens)'), 'number', config); tokens.min = 4096; tokens.max = MAX_MANUAL_INPUT_TOKENS; tokens.step = 1;
    autoBudget.onchange = () => { tokens.disabled = autoBudget.checked; };
    const turns = field(t('整理时保留近期问答的参考值', 'Recent-turn reference for summarization'), 'number', config); turns.min = 1; turns.max = 24; turns.step = 1;
    const auto = field(t('发送时自动整理较早历史（额外模型调用，默认关闭）', 'Auto-summarize on send (extra model call, off by default)'), 'checkbox', config);
    node('small', t('每次最多整理一段有界历史，保留最近问答；计入本轮调用和时间预算。不整理当前工具轨迹，不保证涵盖全部旧历史。', 'At most one bounded prefix per send, retaining recent turns. Uses the same call/time budget; never compacts live tools or guarantees coverage of all older history.'), config);
    const save = button(t('保存上下文设置', 'Save context settings'), config);
    save.onclick = () => act(() => controller.saveContextConfig({ inputTokens: autoBudget.checked ? null : Number(tokens.value), recentTurns: Number(turns.value), autoSummary: auto.checked }));
    const reset = button(t('恢复默认上下文预算并保存', 'Restore and save default context budget'), config);
    reset.onclick = () => act(() => controller.saveContextConfig({ ...CONTEXT_DEFAULTS }));
    const details = node('details', '', parent); details.className = 'gd-muyu-context'; node('summary', t('上下文', 'Context'), details);
    details.open = true;
    const counts = node('p', '', details), coverage = node('p', '', details), usage = node('p', '', details);
    coverage.setAttribute('aria-live', 'polite');
    const recovery = node('div', '', details), recoveryNote = node('small', '', recovery), source = node('select', '', recovery), grant = button(t('允许所选历史资料', 'Allow selected history source'), recovery);
    grant.onclick = () => act(() => controller.grantHistoryPermission(source.value));
    const omit = field(t('本次不携带旧历史（不撤销工具资料授权）', 'Omit history this send (does not revoke tool access)'), 'checkbox', details);
    omit.onchange = () => act(() => controller.setOmitHistory(omit.checked));
    const preview = node('details', '', details); node('summary', t('查看历史摘要', 'View history summary'), preview); const summary = node('p', '', preview);
    const compact = button(t('立即整理历史', 'Summarize history now'), details), clear = button(t('清除摘要', 'Clear summary'), details), confirm = button(t('确认调用模型整理', 'Confirm model summarization'), details), cancel = button(t('取消整理', 'Cancel summarization'), details);
    node('small', t('整理会将本会话较早的问答发送到当前模型；只生成参考摘要，不删除原文。手动整理最多一次调用、30秒，不恢复工具或权限。', 'Summarizing sends older conversation turns to the current model. It creates a reference summary without deleting originals. Manual operation uses at most one call/30 seconds, never restores tools or permissions.'), details);
    confirm.hidden = cancel.hidden = true;
    compact.onclick = () => { confirm.hidden = cancel.hidden = false; };
    cancel.onclick = () => { confirm.hidden = cancel.hidden = true; };
    confirm.onclick = () => { confirm.hidden = cancel.hidden = true; return act(() => controller.compactHistory()); };
    clear.onclick = () => act(() => controller.clearContextSummary());
    let configKey = '', view = null;
    return { render(s) {
        const c = s.contextConfig || CONTEXT_DEFAULTS, key = JSON.stringify(c), ctx = s.context || {};
        if (key !== configKey) { autoBudget.checked = c.inputTokens === null; tokens.value = String(c.inputTokens ?? CONTEXT_DEFAULTS.inputTokens); tokens.disabled = autoBudget.checked; turns.value = String(c.recentTurns); auto.checked = c.autoSummary; configKey = key; }
        save.disabled = !!s.savingContextConfig || s.resetting;
        reset.disabled = save.disabled;
        if (view !== s.viewToken || s.busy || s.resetting) { confirm.hidden = cancel.hidden = true; view = s.viewToken; }
        compact.disabled = clear.disabled = !s.history?.sessionId || s.readOnly || s.busy || s.resetting;
        compact.disabled ||= !s.enabled; clear.disabled ||= !ctx.summary;
        omit.disabled = s.readOnly || s.busy || s.resetting; omit.checked = !!ctx.omitHistory;
        counts.textContent = `${t('计划携带完整问答', 'Planned complete turns')}: ${ctx.turns || 0} · ${t('未覆盖消息', 'Uncovered messages')}: ${ctx.omitted || 0}\n${t('历史部分估算', 'History estimate')}: ${ctx.estimatedTokens || 0} tokens · ${t('摘要', 'Summary')}: ${ctx.summaryStale ? t('来源变化，不使用', 'Stale; not used') : ctx.summaryUsed ? t('使用中', 'In use') : t('未使用', 'Not used')}`;
        if (ctx.omitted > 0) counts.textContent += `\n${t('部分原文未纳入计划；摘要不保证包含每个细节，需要时核对原文。', 'Some original history is not planned; a summary may omit details. Check the original when needed.')}`;
        const covered = ctx.coverage;
        coverage.textContent = covered ? `${t('历史覆盖计划（消息数，非摘要质量保证）', 'History coverage plan (message counts, not a summary quality guarantee)')}: ${covered.total}\n${t('摘要覆盖原文／携带原文／窗口未覆盖／授权或主动排除', 'Summarized originals / raw messages / outside window / excluded by permission or choice')}: ${covered.summarized}/${covered.raw}/${covered.omitted}/${covered.excluded}` : '';
        if (covered?.state === 'blocked') coverage.textContent += t('\n未摘要原文无法完整携带：将尝试整理（若已开启且预算允许），仍放不下则停止。可增加预算、手动整理或明确不携带历史。', '\nThe full unsummarized tail cannot fit: summarization may be attempted if enabled and budgeted; otherwise execution stops. Increase the budget, summarize manually or explicitly omit history.');
        if (covered?.state === 'complete' && covered.summarized > 0) coverage.textContent += t('\n摘要之后的原文连续携带；不代表摘要保留了全部细节。', '\nAll originals after the summary are carried contiguously; this does not guarantee all details survived summarization.');
        const missing = (s.history?.missingPermissions || []).filter(kind => !kind.startsWith('source:providerExecution'));
        recovery.hidden = !missing.length || s.readOnly;
        recoveryNote.textContent = t('历史所需资料授权已到期；不会自动省略对话。可在输入框旁允许携带已有对话（不授予新读取权限），或在此授权具体来源。', 'History source access expired; history will not be silently omitted. Allow existing conversation history beside the composer (no fresh read access), or grant a specific source here.');
        const selected = source.value; source.replaceChildren();
        for (const kind of missing) { const option = node('option', kind.startsWith('source:') ? permissionTitle(kind.slice(7)) : kind, source); option.value = kind; }
        source.value = missing.includes(selected) ? selected : missing[0] || '';
        grant.disabled = s.busy || s.resetting || s.interaction?.status === 'pending' || !missing.length;
        summary.textContent = ctx.summary || t('暂无摘要', 'No summary');
        const last = s.runs?.at(-1)?.process, actual = last?.context;
        usage.textContent = actual ? `${t('最近请求估算／预算', 'Last request estimate / budget')}: ${actual.estimatedTokens}/${actual.inputTokenLimit ?? t('自动', 'auto')} tokens · ${actual.requestBytes} B\n${t('实际保留历史消息', 'Retained historical messages')}: ${actual.historicalMessages ?? '?'}\n${t('消息／工具定义／工具结果／思考回传字节（分项存在包含关系）', 'Message / tool definition / tool result / reasoning bytes (overlapping categories)')}: ${actual.messageBytes}/${actual.toolDefinitionBytes}/${actual.toolResultBytes}/${actual.reasoningBytes}\n${t('实际 Token 见本轮开销；估算非实测', 'Actual tokens appear under run usage; estimates are not measurements')}` : '';
        if (actual?.trimmedHistoricalMessages > 0) usage.textContent += `\n${t('发送前因完整请求超出预算，额外移除了历史消息', 'Additional historical messages removed before sending because the full request exceeded budget')}: ${actual.trimmedHistoricalMessages}`;
        if (last?.coverage?.status === 'blocked') usage.textContent += t('\n最近任务因历史连续性保护停止；未向模型发送缺口上下文。', '\nThe last task stopped to preserve history continuity; no gap context was sent to the model.');
        if (last?.coverage?.status === 'fallback') usage.textContent += t('\n最近任务摘要失败，使用原有历史计划继续；原始记录未删除。', '\nThe last task continued with its original history plan after summarization failed; originals were not deleted.');
        const phase = ctx.compacting ? ctx.progress : last?.summaryPhase || ctx.progress;
        if (actual) usage.textContent += `\n${t('指令部分（包含在请求总量内）', 'Instructions (included in request total)')}: ${actual.instructionBytes ?? 0} B`;
        if (phase === 'summarizing') usage.textContent += t('\n正在整理历史…', '\nSummarizing history…');
        if (phase === 'summary_failed') usage.textContent += t('\n摘要尝试失败，原文保留；旧摘要后的原文必须完整携带，否则停止。取消或超时也会停止。', '\nSummary attempt failed; originals preserved. The full tail after an old summary is required, otherwise execution stops. Cancellation or timeout also stops.');
        if (phase === 'summary_failed' && last?.summaryError) usage.textContent += `\n${t('摘要错误代码', 'Summary error code')}: ${last.summaryError}`;
        if (ctx.usage) usage.textContent += '\n' + formatBudget(ctx.usage, lang);
        if (last?.summaryUsage) usage.textContent += `\n${t('自动摘要调用', 'Auto-summary calls')}: ${last.summaryUsage.calls}\n${t('已报告输入／输出 Token 合计', 'Reported input / output token totals')}: ${last.summaryUsage.inputTokens ?? '?'} / ${last.summaryUsage.outputTokens ?? '?'} (${last.summaryUsage.reports}/${last.summaryUsage.calls} ${t('次有报告；缺失部分未知', 'reported; missing usage unknown')})`;
    } };
}
