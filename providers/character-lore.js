import { registerProvider } from '../provider-registry.js';

/**
 * {{characterLore}} — resolves the director's loreAssignments for the
 * current character into actual world book entry content.
 *
 * Context: requires `character` in the render context (set by
 * getScriptForChar to the current character's name).
 *
 * Pipeline:
 *   directorLedger.loreAssignments["Alice"] → ["地理与空间", "社会结构"]
 *   → worldBooks lookup by entry comment → full content text
 *   → concatenated output
 */
export function register(scanner, getDirectorHistory) {
    registerProvider({
        id: 'characterLore',
        placeholder: '{{characterLore}}',
        render: async (ctx) => {
            const charName = ctx?.character;
            if (!charName) return '';

            const history = getDirectorHistory();
            if (!history.length) return '';

            const latest = history[history.length - 1];
            const assignments = latest?.loreAssignments;
            if (!assignments || typeof assignments !== 'object') return '';

            const names = assignments[charName];
            if (!Array.isArray(names) || names.length === 0) return '';

            // Resolve entry names to content via the world book scanner
            const books = await scanner.scanAll();
            const allEntries = [];
            for (const book of books) {
                for (const entry of book.entries) {
                    if (!entry.disable) {
                        allEntries.push({ comment: entry.comment, content: entry.content, book: book.name });
                    }
                }
            }

            // Deduplicate and resolve
            const seen = new Set();
            const parts = [];
            for (const name of names) {
                if (!name || seen.has(name)) continue;
                seen.add(name);
                const entry = allEntries.find(e => e.comment === name);
                if (entry && entry.content) {
                    parts.push(`[${entry.comment}] (${entry.book})\n${entry.content}`);
                }
            }

            return { content: parts.join('\n\n') };
        },
    });
}
