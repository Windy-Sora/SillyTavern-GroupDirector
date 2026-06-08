import { registerProvider } from '../provider-registry.js';

/**
 * {{worldBookImportance}} — per-entry importance scores (0.000–1.000).
 *
 * Content: ranked list with score and factors
 * Data:    sorted array for path queries
 *
 * Path query examples:
 *   {{?worldBookImportance:0.comment}}       → top entry name
 *   {{?worldBookImportance:0.importance}}     → top entry score
 *   {{?worldBookImportance:0.book}}           → top entry's world book
 */
export function register(scanner) {
    registerProvider({
        id: 'worldBookImportance',
        placeholder: '{{worldBookImportance}}',
        render: async () => {
            const books = await scanner.scanAll();
            if (!books.length) return { content: '', data: [] };

            const scored = scanner.calculateImportance(books);

            const content = scored.slice(0, 30).map((s, i) => {
                const bar = '█'.repeat(Math.round(s.importance * 10));
                const empty = '░'.repeat(10 - bar.length);
                return `${i + 1}. [${s.comment}] _${s.book}_ ${bar}${empty} ${s.importance.toFixed(3)} (${s.factors})`;
            }).join('\n');

            // Also add a summary of always-on entries
            const alwaysOn = scored.filter(s => s.constant && s.importance > 0);
            if (alwaysOn.length > 0) {
                const summary = `\n\n## Always-On Entries (${alwaysOn.length})\n` +
                    alwaysOn.map(s => `- [${s.comment}] _${s.book}_ — ${s.importance.toFixed(3)}`).join('\n');
                return { content: content + summary, data: scored };
            }

            return { content, data: scored };
        },
    });
}
