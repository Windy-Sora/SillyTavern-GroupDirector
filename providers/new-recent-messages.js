import { registerProvider } from '../provider-registry.js';

/**
 * {{newRecentMessages}} — smart context window.
 *
 * - No summary active: same as {{recentMessages}} (last N messages)
 * - Summary active:  [Summary] + [New messages after summary.rangeEnd]
 *
 * Replaces {{chatSummary}}{{recentMessages}} with a single provider
 * that auto-assembles the optimal context. {{recentMessages}} and
 * {{chatSummary}} remain available for custom templates.
 */
export function register(settings, getChat, getLatestActive) {
    registerProvider({
        id: 'newRecentMessages',
        placeholder: '{{newRecentMessages}}',
        render: () => {
            const chat = getChat();
            if (!chat.length) return { content: '' };

            const depth = settings.llmContextDepth || 10;
            const summary = settings.summaryEnabled ? getLatestActive() : null;

            let startIdx;
            let prefix = '';

            if (summary && summary.active && summary.rangeEnd > 0 && summary.content) {
                startIdx = summary.rangeEnd;
                prefix = settings.lang === 'zh'
                    ? `[上下文总结]\n${summary.content}\n\n[最新消息]\n`
                    : `[Chat Summary]\n${summary.content}\n\n[Recent Messages]\n`;
            } else {
                startIdx = Math.max(0, chat.length - depth);
            }

            // Always keep at least the last 'depth' messages visible
            startIdx = Math.min(startIdx, Math.max(0, chat.length - depth));

            const messages = chat.slice(startIdx);
            return {
                content: prefix + messages.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n'),
            };
        },
    });
}
