import { CONTEXT_DEFAULTS } from '../context/policy.js';
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
    node('p', t('输入预算是本地估算目标，不是模型真实窗口；与输出上限分开。每次请求均检查，包括工具结果、定义及必要思考回传。', 'The input budget is a local estimate, not the model window; output limits are separate. Every request is checked, including tool results, definitions and required reasoning replay.'), config);
    const tokens = field(t('输入预算（估算 Token）', 'Input budget (estimated tokens)'), 'number', config); tokens.min = 4096; tokens.max = 128000; tokens.step = 1;
    const turns = field(t('近期完整问答上限', 'Recent complete turn limit'), 'number', config); turns.min = 1; turns.max = 24; turns.step = 1;
    const auto = field(t('发送时自动整理较早历史（额外模型调用，默认关闭）', 'Auto-summarize on send (extra model call, off by default)'), 'checkbox', config);
    node('small', t('每次最多整理一段有界历史，保留最近问答；计入本轮调用和时间预算。不整理当前工具轨迹，不保证涵盖全部旧历史。', 'At most one bounded prefix per send, retaining recent turns. Uses the same call/time budget; never compacts live tools or guarantees coverage of all older history.'), config);
    const save = button(t('保存上下文设置', 'Save context settings'), config);
    save.onclick = () => act(() => controller.saveContextConfig({ inputTokens: Number(tokens.value), recentTurns: Number(turns.value), autoSummary: auto.checked }));
    const details = node('details', '', parent); details.className = 'gd-muyu-context'; node('summary', t('上下文', 'Context'), details);
    details.open = true;
    const counts = node('p', '', details), usage = node('p', '', details);
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
        if (key !== configKey) { tokens.value = String(c.inputTokens); turns.value = String(c.recentTurns); auto.checked = c.autoSummary; configKey = key; }
        save.disabled = !!s.savingContextConfig || s.resetting;
        if (view !== s.viewToken || s.busy || s.resetting) { confirm.hidden = cancel.hidden = true; view = s.viewToken; }
        compact.disabled = clear.disabled = !s.history?.sessionId || s.readOnly || s.busy || s.resetting;
        compact.disabled ||= !s.enabled; clear.disabled ||= !ctx.summary;
        omit.disabled = s.readOnly || s.busy || s.resetting; omit.checked = !!ctx.omitHistory;
        counts.textContent = `${t('计划携带完整问答', 'Planned complete turns')}: ${ctx.turns || 0} · ${t('未覆盖消息', 'Uncovered messages')}: ${ctx.omitted || 0}\n${t('历史部分估算', 'History estimate')}: ${ctx.estimatedTokens || 0} tokens · ${t('摘要', 'Summary')}: ${ctx.summaryStale ? t('来源变化，不使用', 'Stale; not used') : ctx.summaryUsed ? t('使用中', 'In use') : t('未使用', 'Not used')}`;
        const missing = (s.history?.missingPermissions || []).filter(kind => !kind.startsWith('source:providerExecution'));
        recovery.hidden = !missing.length || s.readOnly;
        recoveryNote.textContent = ctx.permissionOmitted ? t('本次因历史资料授权到期，将不发送此前问答。可逐项允许所需来源后再发送；只影响本连接，不会发送消息或修改内容。', 'Earlier turns will not be sent because their source grants expired. Allow exact sources before sending if needed; this affects only this connection and sends nothing now.') : t('历史所需资料尚未授权；可逐项允许后再发送。', 'History sources need permission; you may allow them individually before sending.');
        const selected = source.value; source.replaceChildren();
        for (const kind of missing) { const option = node('option', kind.startsWith('source:') ? permissionTitle(kind.slice(7)) : kind, source); option.value = kind; }
        source.value = missing.includes(selected) ? selected : missing[0] || '';
        grant.disabled = s.busy || s.resetting || s.interaction?.status === 'pending' || !missing.length;
        summary.textContent = ctx.summary || t('暂无摘要', 'No summary');
        const last = s.runs?.at(-1)?.process, actual = last?.context;
        usage.textContent = actual ? `${t('最近请求估算／预算', 'Last request estimate / budget')}: ${actual.estimatedTokens}/${actual.inputTokenLimit ?? c.inputTokens} tokens · ${actual.requestBytes} B\n${t('实际保留历史消息', 'Retained historical messages')}: ${actual.historicalMessages ?? '?'}\n${t('消息／工具定义／工具结果／思考回传字节（分项存在包含关系）', 'Message / tool definition / tool result / reasoning bytes (overlapping categories)')}: ${actual.messageBytes}/${actual.toolDefinitionBytes}/${actual.toolResultBytes}/${actual.reasoningBytes}\n${t('实际 Token 见本轮开销；估算非实测', 'Actual tokens appear under run usage; estimates are not measurements')}` : '';
        const phase = ctx.compacting ? ctx.progress : last?.summaryPhase || ctx.progress;
        if (actual) usage.textContent += `\n${t('指令部分（包含在请求总量内）', 'Instructions (included in request total)')}: ${actual.instructionBytes ?? 0} B`;
        if (phase === 'summarizing') usage.textContent += t('\n正在整理历史…', '\nSummarizing history…');
        if (phase === 'summary_failed') usage.textContent += t('\n摘要未提交，原文保留；自动整理普通失败可回退，取消或超时停止。', '\nSummary not committed; originals preserved. Auto-summary may fall back on ordinary failures; cancellation or timeout stops.');
        if (ctx.usage) usage.textContent += '\n' + formatBudget(ctx.usage, lang);
        if (last?.summaryUsage) usage.textContent += `\n${t('自动摘要：1 次调用，实际输入／输出 Token', 'Auto-summary: 1 call, actual input / output tokens')}: ${last.summaryUsage.inputTokens ?? '?'} / ${last.summaryUsage.outputTokens ?? '?'}`;
    } };
}
