import { processTools } from '../application/process-store.js';
import { formatBudget } from './budget-view.js';

const labels = {
    yielded: ['已交接，等待用户处理', 'Handed off for user input'],
    queued: ['等待执行', 'Queued'], running: ['任务开始', 'Run started'],
    'model.started': ['正在请求模型', 'Requesting model'], 'model.completed': ['已收到模型响应', 'Model response received'],
    'model.failed': ['模型调用失败', 'Model request failed'],
    'tool.requested': ['检查工具调用', 'Checking tool request'], 'tool.started': ['正在执行工具', 'Executing tool'],
    'tool.reused': ['复用已有结果', 'Reusing prior result'], 'tool.completed': ['工具返回成功', 'Tool returned successfully'],
    'tool.failed': ['工具返回失败或被拒绝', 'Tool failed or was rejected'],
    cancelling: ['正在取消', 'Cancelling'], succeeded: ['回答完成', 'Answer completed'], failed: ['任务失败', 'Run failed'],
    cancelled: ['任务已取消', 'Run cancelled'], interrupted: ['任务中断', 'Run interrupted'],
};
const errors = {
    PERMISSION_REQUIRED: ['需要读取授权', 'Read permission required'], PERMISSION_DENIED: ['权限拒绝', 'Permission denied'], PERMISSION_REQUEST_INVALID: ['授权申请无效或已经获准', 'Invalid or already granted permission request'], INVALID_ARGUMENT: ['参数不符合契约', 'Invalid arguments'],
    CALL_ID_CONFLICT: ['调用编号冲突', 'Call ID conflict'], UNSUPPORTED_CAPABILITY: ['不支持此能力', 'Unsupported capability'],
    TARGET_UNAVAILABLE: ['目标已不可用', 'Target unavailable'], UPSTREAM_PENDING: ['上游尚未清理', 'Upstream still pending'],
    OUTPUT_INVALID: ['返回值不符合契约', 'Invalid output'], TIMEOUT: ['超时', 'Timed out'], TOOL_FAILED: ['工具执行失败', 'Tool execution failed'],
    CANCELLED: ['已取消', 'Cancelled'], BUDGET_EXCEEDED: ['达到调用预算', 'Call budget reached'],
    MODEL_NETWORK_ERROR: ['网络失败，可能涉及 CORS', 'Network failure; CORS is possible'], MODEL_AUTH_ERROR: ['认证或访问被拒绝', 'Authentication/access rejected'],
    MODEL_RATE_LIMIT: ['服务限流', 'Service rate limit'], MODEL_SERVICE_ERROR: ['模型服务失败', 'Model service failure'],
};
const local = (pair, lang) => pair[lang === 'en' ? 1 : 0];
export function processLabel(process, lang = 'zh') {
    if (!process) return '';
    const text = local(labels[process.phase] || ['处理中', 'Processing'], lang);
    return text + (process.terminal && !process.cleaned ? local([' · 等待上游清理', ' · Waiting for cleanup'], lang) : '');
}

/** Stable details nodes preserve expansion/focus and scroll across progress notifications. */
export function createProcessView({ doc, lang = 'zh' }) {
    const nodes = new Map();
    const node = (tag, text, parent) => { const el = doc.createElement(tag); el.textContent = text; if (parent) parent.append(el); return el; };
    return {
        update(run, artifactPresent, expectsArtifact = true) {
            const p = run.process; if (!p) return null;
            let view = nodes.get(run.id);
            if (!view) {
                const root = node('details', ''); root.className = 'gd-muyu-process';
                view = { root, summary: node('summary', '', root), list: node('ol', '', root), note: node('p', '', root), signature: '' };
                nodes.set(run.id, view);
            }
            view.summary.textContent = local(['执行过程', 'Execution process'], lang) + ' · ' + processLabel(p, lang);
            const signature = JSON.stringify(p.rows);
            if (signature !== view.signature) {
                const scrollTop = view.list.scrollTop;
                view.signature = signature; view.list.replaceChildren();
                for (const row of p.rows) {
                    const tool = row.tool ? local(processTools[row.tool] || ['未知工具', 'Unknown tool'], lang) + ' · ' : '';
                    const error = row.error ? ' · ' + local(errors[row.error] || ['安全错误（无原始详情）', 'Safe error (no raw details)'], lang) : '';
                    if (row.read) node('li', `${row.read.source} · ${row.read.status} · ${row.read.characters}` + local([' 字符', ' characters'], lang) + (row.read.truncated ? local([' · 内容未完整返回', ' · Partial content'], lang) : ''), view.list);
                    node('li', tool + local(labels[row.type] || ['处理中', 'Processing'], lang) + ` #${row.attemptId}` + (row.durationMs === null ? '' : ` · ${row.durationMs} ms`) + error, view.list);
                }
                view.list.scrollTop = scrollTop;
            }
            const notes = [];
            if (p.toolFailures) notes.push(local(['包含失败或被拒绝的工具调用', 'Includes failed/rejected tool calls'], lang));
            if (p.dropped) notes.push(local(['较早过程记录已截断', 'Earlier process records were truncated'], lang));
            if (p.terminal === 'succeeded' && expectsArtifact && !artifactPresent) notes.push(local(['回答已结束；尚无可信报告或草稿', 'Answer ended; no verified report or draft available'], lang));
            if (p.error) notes.push(local(errors[p.error] || ['任务结束时发生错误', 'Run ended with an error'], lang));
            view.note.textContent = notes.join(' · ') + (p.budget ? '\n' + formatBudget(p.budget, lang) : '');
            return view.root;
        },
        retain(ids) { for (const [id, view] of nodes) if (!ids.has(id)) { view.root.remove(); nodes.delete(id); } },
        clear() { nodes.clear(); },
    };
}
