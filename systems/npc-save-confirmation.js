import { snapshotValue } from './execution-snapshot.js';

// SillyTavern's saveChatConditional resolves even when its save fails or times out.
// Read back the chat header to confirm that the NPC state reached storage.
export function createConfirmedNpcChatSave({
    saveChatConditional, getCurrentChatId, getCurrentGroup, getContext,
    getChatMetadata, getRequestHeaders, EXT_KEY,
    fetchChat = fetch,
}) {
    return async function saveNpcChatConfirmed(metadata = getChatMetadata()) {
        const chatId = getCurrentChatId();
        if (!chatId) throw new Error('No chat is available for NPC persistence');
        const group = getCurrentGroup();
        const context = group ? null : getContext();
        const character = context?.characters?.[context.characterId];
        if (!group && !character) throw new Error('No character is available for NPC persistence');
        const expected = snapshotValue(metadata[EXT_KEY]?.npcs ?? []);

        await saveChatConditional();

        const response = await fetchChat(group ? '/api/chats/group/get' : '/api/chats/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            cache: 'no-cache',
            body: JSON.stringify(group
                ? { id: chatId }
                : { ch_name: character.name, file_name: chatId, avatar_url: character.avatar }),
        });
        if (!response.ok) throw new Error(`NPC persistence could not be confirmed: HTTP ${response.status}`);
        const storedChat = await response.json();
        const storedNpcs = Array.isArray(storedChat) && storedChat.length
            ? storedChat[0]?.chat_metadata?.[EXT_KEY]?.npcs ?? []
            : null;
        const stored = snapshotValue(storedNpcs);
        // A concurrent NPC edit may have reached storage during the same host
        // save. Either the submitted state or the current state is sufficient.
        if (stored !== expected && stored !== snapshotValue(metadata[EXT_KEY]?.npcs ?? [])) {
            throw new Error('NPC persistence could not be confirmed');
        }
    };
}
