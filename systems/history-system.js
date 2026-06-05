export function createHistorySystem({ chat_metadata, EXT_KEY, chat, saveChatConditional, settings, log }) {

    function getDirectorHistory() {
        return chat_metadata?.[EXT_KEY]?.directorHistory || [];
    }

    async function addToDirectorHistory(entry) {
        if (!chat_metadata[EXT_KEY]) chat_metadata[EXT_KEY] = {};
        if (!chat_metadata[EXT_KEY].historyMeta) chat_metadata[EXT_KEY].historyMeta = {};
        if (!chat_metadata[EXT_KEY].directorHistory) chat_metadata[EXT_KEY].directorHistory = [];
        entry._chatLength = chat.length;
        chat_metadata[EXT_KEY].directorHistory.push(entry);
        if (chat_metadata[EXT_KEY].historyMeta.scriptPrompt !== settings.llmScriptPrompt) {
            chat_metadata[EXT_KEY].historyMeta.scriptPrompt = settings.llmScriptPrompt;
        }
        await saveChatConditional();
    }

    function pruneDirectorHistory(newChatLength) {
        const history = getDirectorHistory();
        if (!history.length) return;
        const pruned = history.filter(e => (e._chatLength || 0) <= newChatLength);
        if (pruned.length < history.length) {
            chat_metadata[EXT_KEY].directorHistory = pruned;
            saveChatConditional();
            log(`Pruned ${history.length - pruned.length} stale director history entries (chatLength=${newChatLength})`);
        }
    }

    return { getDirectorHistory, addToDirectorHistory, pruneDirectorHistory };
}
