import { peekVariables, peekBlueprintState } from '../../systems/provider-read-data.js';
import { copyJson } from '../core/json-contract.js';

const object = x => x && typeof x === 'object' && !Array.isArray(x);
const text = x => typeof x === 'string' ? x : '';
const fail = code => { throw Error(code); };
function json(value) {
    try { return copyJson(value); } catch { return fail('SOURCE_UNSUPPORTED'); }
}
function result(value, directory, identity, limited = false) {
    const body = JSON.stringify(value);
    if (body.length > 131072) fail('SOURCE_TOO_LARGE');
    return { text: body, limited, directory, ...(identity === undefined ? {} : { identity }) };
}
function index(selector, prefix, length) {
    const match = new RegExp('^' + prefix + ':(0|[1-9]\\d{0,3})$').exec(selector);
    if (!match || Number(match[1]) >= length) fail('INVALID_SELECTOR');
    return Number(match[1]);
}

/** Stored values only: never initialize, coerce, fill defaults, or run update rules. */
export function readVariables(selector, ctx, key) {
    const store = peekVariables(ctx.chatMetadata, key);
    if (store === undefined) return selector ? fail('INVALID_SELECTOR') : { text: '', limited: false };
    if (!object(store) || !Array.isArray(store.defs) || !object(store.values)) fail('SOURCE_UNSUPPORTED');
    if (store.defs.length > 256) fail('SOURCE_TOO_LARGE');
    const entries = [], seen = new Set();
    const add = entry => { if (entries.length >= 512) fail('SOURCE_TOO_LARGE'); entries.push(entry); };
    for (const def of store.defs) {
        if (!object(def) || typeof def.id !== 'string' || !def.id || seen.has(def.id) || !['global', 'character'].includes(def.scope) || !['string', 'number', 'boolean', 'enum', 'array', 'object'].includes(def.type)) fail('SOURCE_UNSUPPORTED');
        seen.add(def.id);
        const base = { id: def.id, label: text(def.label), type: def.type, scope: def.scope === 'global' ? 'chat-global' : 'chat-character' };
        const bucket = def.scope === 'global' ? store.values.global : store.values.character?.[def.id];
        if (bucket !== undefined && !object(bucket)) fail('SOURCE_UNSUPPORTED');
        if (def.scope === 'global') add({ base, bucket: bucket || {}, storageKey: def.id });
        else {
            const keys = Object.keys(bucket || {});
            if (keys.length > 256) fail('SOURCE_TOO_LARGE');
            if (!keys.length) add({ base: { ...base, character: '', note: 'No stored character values; defaults are not evaluated.' }, bucket: {}, storageKey: '' });
            for (const storageKey of keys) {
                const characters = Array.isArray(ctx.characters) ? ctx.characters : [];
                const character = characters.find(c => c?.avatar === storageKey) || characters.find(c => c?.name === storageKey);
                add({ base: { ...base, character: text(character?.name) || 'Unresolved character' }, bucket, storageKey });
            }
        }
    }
    // Private evidence binds opaque selectors to storage identities without exporting avatar filenames.
    const directory = entries.map(e => [e.base, e.storageKey]);
    if (!selector) return result({ scope: 'chat', origin: 'stored-memory', persistence: 'unknown', note: 'global means this chat, not all chats. Stored values only; defaults/rules are not evaluated.', items: entries.map((e, i) => ({ selector: 'item:' + i, ...e.base })) }, directory);
    const i = index(selector, 'item', entries.length), e = entries[i];
    const present = Object.hasOwn(e.bucket, e.storageKey);
    return result({ ...e.base, state: present ? 'stored' : 'missing', ...(present ? { value: json(e.bucket[e.storageKey]) } : {}), note: 'Not an effective/defaulted value or persistence confirmation.' }, directory, directory[i]);
}

/** Saved signals are evidence, not a recomputed execution/progress claim. */
export function readBlueprint(selector, ctx, key, settings) {
    if (!settings.storyBlueprintEnabled) fail('SOURCE_DISABLED');
    const state = peekBlueprintState(ctx.chatMetadata, key);
    if (state === undefined || state?.blueprint === null) return selector ? fail('INVALID_SELECTOR') : { text: '', limited: false };
    const bp = state?.blueprint;
    if (!object(bp) || !Array.isArray(bp.nodes) || !Array.isArray(state.doneSignals)) fail('SOURCE_UNSUPPORTED');
    if (state.doneSignals.length > 1024) fail('SOURCE_TOO_LARGE');
    const nodes = [], ancestors = new Set(), ids = new Set();
    function walk(list, parent, depth) {
        if (depth > 16 || list.length > 512) fail('SOURCE_TOO_LARGE');
        for (const node of list) {
            if (!object(node) || ancestors.has(node) || typeof node.id !== 'string' || ids.has(node.id) || !Array.isArray(node.children)) fail('SOURCE_UNSUPPORTED');
            if (nodes.length >= 512) fail('SOURCE_TOO_LARGE');
            ids.add(node.id); ancestors.add(node);
            const i = nodes.length; nodes.push({ node, parent }); walk(node.children, i, depth + 1); ancestors.delete(node);
        }
    }
    walk(bp.nodes, -1, 0);
    const directory = nodes.map(({ node, parent }) => ({ id: node.id, title: text(node.title), type: text(node.type), parent }));
    if (!selector) return result({ title: text(bp.title), scope: 'chat', origin: 'stored-memory', persistence: 'unknown', savedSignalCount: state.doneSignals.length, note: 'Saved signals are not validated execution or current progress. Custom root metadata omitted.', nodes: directory.map((n, i) => ({ selector: 'node:' + i, ...n })) }, directory, undefined, true);
    const i = index(selector, 'node', nodes.length), node = nodes[i].node;
    const signals = state.doneSignals.filter(s => object(s) && s.nodeId === node.id).map(s => ({ nodeId: s.nodeId, ...(Number.isSafeInteger(s.stepIndex) ? { stepIndex: s.stepIndex } : {}), ...(Number.isSafeInteger(s.chatLength) ? { chatLength: s.chatLength } : {}) }));
    return result({ ...directory[i], content: json(node.content), children: nodes.flatMap((n, j) => n.parent === i ? ['node:' + j] : []), savedSignals: signals, note: 'Raw saved signals, not execution confirmation; no pruning performed. Extra node fields omitted.' }, directory, node.id, Object.keys(node).some(k => !['id', 'title', 'type', 'content', 'children'].includes(k)));
}
