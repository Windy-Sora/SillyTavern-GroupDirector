const str = maxLength => ({ type: 'string', maxLength });
export const readHintSchema = { type: 'object', properties: {
    kind: { type: 'string', enum: ['directory', 'content', 'structured', 'unavailable'] },
    selectorFormat: str(64), exampleSelector: str(32),
    recovery: { type: 'string', enum: ['none', 'correct_selector', 'read_directory', 'stop'] },
    continuation: { type: 'object', properties: { id: str(64), token: str(40) }, required: ['id', 'token'], additionalProperties: false },
    error: { type: 'object', properties: { field: str(32), expected: str(320), retryable: { type: 'boolean' } }, required: ['field', 'expected', 'retryable'], additionalProperties: false },
    nextRead: { type: 'object', properties: { id: str(64), selector: str(32), revision: str(40), offset: { type: 'integer', minimum: 0, maximum: 131072 } }, required: ['id', 'selector', 'revision', 'offset'], additionalProperties: false },
}, required: ['kind', 'selectorFormat', 'exampleSelector', 'recovery'], additionalProperties: false };

const directories = new Set(['chatHistory', 'directorHistory', 'characters', 'charMemory', 'character_profiles', 'variables', 'variableDiagnostics', 'storyBlueprint', 'stWorldBookEntries', 'stPresets']);
const examples = { chatHistory: 'range:0:20', directorHistory: 'range:0:10', characters: 'character:0', charMemory: 'character:0', character_profiles: 'character:0', variables: 'item:0', variableDiagnostics: 'item:0', storyBlueprint: 'node:0', stWorldBookEntries: 'book:0', stPresets: 'mode:0' };

/** Protocol hints only: never expose private directory evidence or authorize a read. */
export function readHint(source, args, response, fresh = null) {
    const ok = ['ok', 'empty'].includes(response.status);
    const directory = source.format === 'text' && directories.has(source.id) && (!args.selector || source.id === 'stWorldBookEntries' && /^book:\d+$/.test(args.selector) || source.id === 'stPresets' && /^mode:\d+$/.test(args.selector));
    const hint = { kind: !ok ? 'unavailable' : source.format === 'structured' ? 'structured' : directory ? 'directory' : 'content',
        selectorFormat: source.selector, exampleSelector: examples[source.id] || '',
        recovery: response.status === 'INVALID_SELECTOR' || response.status === 'INVALID_READ_ARGUMENTS' ? 'correct_selector' : response.status === 'STALE_SOURCE' || response.status === 'INVALID_CONTINUATION' ? 'read_directory' : ok ? 'none' : 'stop' };
    if (response.status === 'INVALID_SELECTOR') hint.error = { field: 'selector', expected: source.format === 'structured' ? 'Use empty selector/revision and offset=0 for this structured source.' : `Use ${source.selector}; example ${examples[source.id] || '(see directory)'}. Read the directory first; examples do not prove an item exists.`, retryable: true };
    if (response.status === 'INVALID_READ_ARGUMENTS') hint.error = { field: 'arguments', expected: 'Use {id} for the directory, {id,continuationToken} for a host-issued continuation, or all of {id,selector,revision,offset}. Do not mix these forms.', retryable: true };
    if (response.status === 'INVALID_CONTINUATION') hint.error = { field: 'continuationToken', expected: 'Use an issued token from this run and source, or reread the directory with {id}. Tokens do not survive new tasks or reconnects.', retryable: true };
    if (response.status === 'STALE_SOURCE') hint.error = { field: 'revision', expected: 'Source or directory changed: reread its directory, then use the newly returned revision or continuation.', retryable: true };
    if (response.status === 'BUDGET_EXCEEDED') hint.error = { field: 'budget', expected: 'Stop reading this run: the next page cannot fit the remaining byte budget. Report the unread gap; do not guess or request later offsets.', retryable: false };
    const next = (selector, revision, offset = 0) => ({ id: source.id, selector, revision, offset });
    if (response.status === 'STALE_SOURCE') hint.nextRead = next('', '');
    else if (ok && response.nextOffset >= 0) hint.nextRead = next(args.selector, response.revision, response.nextOffset);
    else if (ok && directory && ['chatHistory', 'directorHistory'].includes(source.id)) {
        // Count comes from the fixed first-party directory projection, not raw metadata.
        const match = /^(?:messages|records)=(\d+);/.exec(fresh?.text || '');
        const count = match && Number(match[1]);
        if (Number.isSafeInteger(count) && count > 0) hint.nextRead = next(`range:0:${Math.min(count, source.id === 'chatHistory' ? 20 : 10)}`, response.revision);
    }
    return hint;
}
