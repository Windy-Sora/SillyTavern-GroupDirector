import {
    assertExecutionSnapshot,
    captureExecutionSnapshot,
    snapshotValue,
} from './execution-snapshot.js';

export function createChatSummarySystem({ settings, getChatMetadata, getChat, EXT_KEY, saveChatConditional, renderPrompt, generateRaw, inject_ids, extension_prompt_types, setExtensionPrompt, log, createCaller }) {
    const cm = () => getChatMetadata();
    let summarizing = false;

    function getCaller() {
        const agentConfig = settings.agentConfigs?.['summary'] || {};
        const stGenerateRaw = (opts) => generateRaw(opts);
        return createCaller(agentConfig, stGenerateRaw);
    }

    const DEFAULT_PROMPT = {
        zh: '请用简洁的语言总结以下内容，保留关键情节、角色互动和重要细节。输出纯文本，不超过500字。',
        en: 'Summarize the following content concisely. Keep key plot points, character interactions, and important details. Output plain text, maximum 300 words.',
    };

    function getSummaries(metadata = cm()) {
        const meta = metadata;
        if (!meta[EXT_KEY]) meta[EXT_KEY] = {};
        if (!meta[EXT_KEY].summaries) meta[EXT_KEY].summaries = [];
        return meta[EXT_KEY].summaries;
    }

    function getLatestActive(metadata = cm()) {
        const summaries = getSummaries(metadata);
        for (let i = summaries.length - 1; i >= 0; i--) {
            if (summaries[i].active) return summaries[i];
        }
        return null;
    }

    function getActiveSummaryText() {
        if (summarizing || !settings.summaryEnabled) return '';
        const active = getLatestActive();
        return active ? active.content : '';
    }

    async function generateSummary() {
        if (summarizing) throw new Error('Summary already in progress');
        const executionSnapshot = captureExecutionSnapshot({
            getChatMetadata,
            getChat,
            getResource: (metadata, chat) => ({
                summaries: getSummaries(metadata),
                chat: chat.map(message => [message.name, message.mes, message.is_user, message.is_system]),
            }),
        });
        const { metadata, chat } = executionSnapshot;
        if (!chat.length) throw new Error('No messages to summarize');

        const summaries = getSummaries(metadata);
        const reusePrev = settings.summaryReusePrevious;
        const prevSummary = getLatestActive(metadata);
        const rangeEnd = chat.length;

        let inputText = '';
        let startFrom = 0;

        if (reusePrev && prevSummary && prevSummary.rangeEnd <= chat.length) {
            // Previous summary + new messages since last range end
            startFrom = prevSummary.rangeEnd;
            const newMessages = chat.slice(startFrom);
            if (!newMessages.length) throw new Error('No new messages since last summary');
            inputText = `[Previous summary]\n${prevSummary.content}\n\n[New content]\n` +
                newMessages.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
        } else {
            // Full chat
            inputText = chat.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
        }

        const promptUsed = settings.summaryPrompt || (settings.lang === 'zh' ? DEFAULT_PROMPT.zh : DEFAULT_PROMPT.en);
        const prompt = promptUsed + '\n\n' + inputText;

        summarizing = true;
        try {
            setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);
            const response = await getCaller().generate(prompt);
            setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);
            assertExecutionSnapshot(executionSnapshot, {
                getChatMetadata,
                getChat,
                getResource: (currentMetadata, currentChat) => ({
                    summaries: getSummaries(currentMetadata),
                    chat: currentChat.map(message => [message.name, message.mes, message.is_user, message.is_system]),
                }),
                message: 'Summary generation became stale',
            });

            const entry = {
                rangeEnd,
                content: response || '',
                active: true,
                basedOn: reusePrev && prevSummary ? summaries.indexOf(prevSummary) : null,
                promptUsed,
                timestamp: Date.now(),
            };

            const previousState = structuredClone(summaries);
            // Deactivate previous active summaries
            for (const s of summaries) s.active = false;
            summaries.push(entry);
            const appliedState = snapshotValue(summaries);
            try { await saveChatConditional(); }
            catch (error) {
                if (snapshotValue(summaries) === appliedState) summaries.splice(0, summaries.length, ...previousState);
                throw error;
            }
            return entry;
        } finally {
            summarizing = false;
        }
    }

    async function regenerateLastSummary() {
        if (summarizing) throw new Error('Summary already in progress');
        const executionSnapshot = captureExecutionSnapshot({
            getChatMetadata,
            getChat,
            getResource: (metadata, chat) => ({
                summaries: getSummaries(metadata),
                chat: chat.map(message => [message.name, message.mes, message.is_user, message.is_system]),
            }),
        });
        const { metadata, chat } = executionSnapshot;
        const summaries = getSummaries(metadata);

        const last = getLatestActive(metadata);
        if (!last) throw new Error('No active summary to regenerate');

        let inputText = '';
        if (last.basedOn !== null && last.basedOn >= 0 && summaries[last.basedOn]) {
            const prev = summaries[last.basedOn];
            const newMessages = chat.slice(prev.rangeEnd, last.rangeEnd);
            inputText = `[Previous summary]\n${prev.content}\n\n[New content]\n` +
                newMessages.map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
        } else {
            inputText = chat.slice(0, last.rangeEnd)
                .map(m => `${m.name || (m.is_user ? 'User' : 'System')}: ${m.mes}`).join('\n');
        }

        const promptUsed = last.promptUsed || settings.summaryPrompt || (settings.lang === 'zh' ? DEFAULT_PROMPT.zh : DEFAULT_PROMPT.en);
        const prompt = promptUsed + '\n\n' + inputText;

        summarizing = true;
        try {
            setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);
            const response = await getCaller().generate(prompt);
            setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);
            assertExecutionSnapshot(executionSnapshot, {
                getChatMetadata,
                getChat,
                getResource: (currentMetadata, currentChat) => ({
                    summaries: getSummaries(currentMetadata),
                    chat: currentChat.map(message => [message.name, message.mes, message.is_user, message.is_system]),
                }),
                message: 'Summary regeneration became stale',
            });

            const previous = { content: last.content, promptUsed: last.promptUsed, timestamp: last.timestamp };
            last.content = response || '';
            last.promptUsed = promptUsed;
            last.timestamp = Date.now();
            const appliedState = snapshotValue(last);
            try { await saveChatConditional(); }
            catch (error) {
                if (snapshotValue(last) === appliedState) Object.assign(last, previous);
                throw error;
            }
            return last;
        } finally {
            summarizing = false;
        }
    }

    async function revertLastSummary() {
        const summaries = getSummaries();
        if (!summaries.length) return false;

        // Find the most recently active summary, not just the last in array
        let target = null;
        let foundIndex = -1;
        for (let i = summaries.length - 1; i >= 0; i--) {
            if (summaries[i].active) { target = summaries[i]; foundIndex = i; break; }
        }
        if (!target) return false;

        target.active = false;

        // Activate previous summary if exists (must precede this entry)
        if (target.basedOn !== null && target.basedOn >= 0 && target.basedOn < foundIndex && summaries[target.basedOn]) {
            summaries[target.basedOn].active = true;
        }

        await saveChatConditional();
        return true;
    }

    async function resetAll() {
        const summaries = getSummaries();
        for (const s of summaries) s.active = false;
        await saveChatConditional();
    }

    // Auto-prune on message deletion
    async function pruneSummaries() {
        const chat = getChat();
        const summaries = getSummaries();
        if (!summaries.length) return;

        let changed = false;
        for (const s of summaries) {
            if (s.active && s.rangeEnd > chat.length) {
                s.active = false;
                changed = true;
                // Activate previous
                if (s.basedOn !== null && s.basedOn >= 0 && summaries[s.basedOn]) {
                    summaries[s.basedOn].active = true;
                }
            }
        }
        if (changed) await saveChatConditional();
    }

    return {
        getActiveSummaryText,
        getLatestActive,
        getSummaries,
        generateSummary,
        regenerateLastSummary,
        revertLastSummary,
        resetAll,
        pruneSummaries,
    };
}
