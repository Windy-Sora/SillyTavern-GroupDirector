import { registerProvider } from '../provider-registry.js';

/**
 * {{newRecentMessages}} — recent messages since the last summary rangeEnd,
 * or full recent messages if no summary is active.
 *
 * Pairs with {{chatSummary}}: when a summary covers the first N messages,
 * this provider returns only messages after position N, avoiding redundant
 * context that the summary already compressed.
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
            if (summary && summary.active && summary.rangeEnd > 0) {
                // Start after the summarized range
                startIdx = summary.rangeEnd;
            } else {
                // No summary — use normal depth window
                startIdx = Math.max(0, chat.length - depth);
            }

            // But always keep at least the last 'depth' messages visible
            const minStart = Math.max(0, chat.length - depth);
            startIdx = Math.min(startIdx, minStart);

            const messages = chat.slice(startIdx);
            return {
                content: messages.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n'),
            };
        },
    });
}
