import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../index.js', import.meta.url), 'utf8');

function listenerStarts(eventName) {
    const needle = `eventSource.on(event_types.${eventName}`;
    const starts = [];
    let cursor = 0;
    while ((cursor = source.indexOf(needle, cursor)) >= 0) {
        starts.push(cursor);
        cursor += needle.length;
    }
    return starts;
}

function listenerBlock(eventName, occurrence = 0) {
    const start = listenerStarts(eventName)[occurrence];
    assert.notEqual(start, undefined, `missing ${eventName} listener #${occurrence + 1}`);
    const next = source.indexOf('eventSource.on(event_types.', start + 1);
    return source.slice(start, next < 0 ? source.length : next);
}

function assertOrdered(block, fragments) {
    let cursor = -1;
    for (const fragment of fragments) {
        const next = block.indexOf(fragment);
        assert.ok(next >= 0, `missing orchestration fragment: ${fragment}`);
        assert.ok(next > cursor, `fragment is out of order: ${fragment}`);
        cursor = next;
    }
}

test('index registers the complete SillyTavern event surface exactly once', () => {
    const expected = {
        GROUP_WRAPPER_STARTED: 1,
        GROUP_WRAPPER_FINISHED: 1,
        GENERATION_STOPPED: 1,
        CHARACTER_MESSAGE_RENDERED: 2,
        MESSAGE_DELETED: 1,
        CHAT_CHANGED: 1,
        APP_READY: 1,
    };
    const registrations = [...source.matchAll(/eventSource\.on\(event_types\.([A-Z_]+)/g)]
        .map(match => match[1]);
    assert.deepEqual(
        Object.fromEntries(Object.keys(expected).map(name => [name, registrations.filter(value => value === name).length])),
        expected,
    );
    assert.deepEqual([...new Set(registrations)].sort(), Object.keys(expected).sort());
});

test('new group rounds reset stale runtime state before clearing persisted counters', () => {
    const block = listenerBlock('GROUP_WRAPPER_STARTED');
    assertOrdered(block, [
        'roundOrchestrator.startWrapper',
        "wrapperTransition.kind === 'preserve_nested'",
        "wrapperTransition.kind === 'retry_failed'",
        "wrapperTransition.kind === 'reuse_or_restore_plan'",
        'roundScores = {}',
        'roundOrchestrator.reset()',
        'scriptExecutorSystem.resetTurnShared()',
        "setExtensionPrompt(DIRECTOR_SCRIPT_KEY, ''",
        'roundCounterReset()',
        'scriptCounterSnapshots.clear()',
        'delete chat_metadata[EXT_KEY]._counterSnapshots',
    ]);
});

test('stop cleanup aborts every active LLM path before the disabled-mode return', () => {
    const block = listenerBlock('GENERATION_STOPPED');
    assertOrdered(block, [
        'generationStopped = true',
        'postSpeechAbortController.abort()',
        'postSpeechMessageAbortController.abort()',
        'directorAbortController.abort()',
        'if (settings.mode === MODE_OFF) return',
    ]);
});

test('message rollback invalidates execution state before pruning dependent stores', () => {
    const block = listenerBlock('MESSAGE_DELETED');
    assertOrdered(block, [
        'customAgentSystem.invalidateExecutions()',
        'roundOrchestrator.reset()',
        'scriptCounterSnapshots.clear()',
        'await pruneDirectorHistory()',
        'await chatSummarySystem.pruneSummaries()',
        'await postSpeechSystem.pruneAfter(newChatLength - 1)',
    ]);
});

test('chat changes reset library dedup and all chat-bound automatic counters', () => {
    const block = listenerBlock('CHAT_CHANGED');
    assertOrdered(block, [
        'customAgentSystem.invalidateExecutions()',
        'profileLibrarySystem.resetAutoLoadDedup?.()',
        'await pruneDirectorHistory()',
        'await chatSummarySystem.pruneSummaries()',
        'await critiqueSystem.pruneCritiques()',
        'await postSpeechSystem.clearAll()',
        "delete chat_metadata[EXT_KEY]._autoCheckLength",
        "key.startsWith('_autoCAG_')",
        "profileLibrarySystem.autoLoadForCurrentGroup('chat-changed')",
    ]);
});

test('APP_READY builds UI before restoring user modules and capability persistence hooks', () => {
    const block = listenerBlock('APP_READY');
    assertOrdered(block, [
        'await loadSettingsUI(deps)',
        "profileLibrarySystem.autoLoadForCurrentGroup('app-ready')",
        "userProviderLoader.restoreAll('provider'",
        "userProviderLoader.restoreAll('capability'",
        'CapabilityRegistry.setEnabled = function',
        'CapabilityRegistry.setScope = function',
    ]);
});
