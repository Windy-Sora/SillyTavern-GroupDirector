import test from 'node:test';
import assert from 'node:assert/strict';
import { openSettingsHistoryStore, SETTINGS_HISTORY_LIMITS } from '../../muyu/sessions/settings-store.js';
import { createHistoryPort } from '../../muyu/host/history.js';
import { historyScope } from '../../muyu/sessions/contract.js';
import { createConfigProfileSubject } from './helpers/config-profile-subject.mjs';
import { sanitizeImportedSettings } from '../../systems/config-profile-validation.js';
import { deferred } from './helpers/muyu-subject.mjs';

const namespace = '12345678-1234-1234-1234-123456789012';
const record = () => ({ version: 5, id: crypto.randomUUID(), revision: 0, scope: historyScope('assistant', { kind: 'chat', chatKey: 'A' }), title: 'Account history', createdAt: 1, updatedAt: 1, messages: [], required: [], status: 'idle', archived: false, imported: false, contextSummary: null, receipts: [] });
function fixture(save = async () => {}) {
    const settings = { other: 'untouched' };
    return { settings, store: openSettingsHistoryStore({ namespace, getSettings: () => settings, saveSettings: save }) };
}

test('Account settings history persists and restores independent conversation DTOs', async () => {
    const f = fixture(); const saved = await f.store.create(record());
    assert.equal(saved.revision, 1); assert.equal(f.store.kind, 'account-settings');
    const restored = JSON.parse(JSON.stringify(f.settings));
    const store = openSettingsHistoryStore({ namespace, getSettings: () => restored, saveSettings: async () => {} });
    assert.deepEqual(await store.read(saved.id), saved);
    assert.equal((await store.list())[0].count, 0); assert.equal(restored.other, 'untouched');
    const copy = await store.read(saved.id); copy.title = 'private copy';
    assert.equal((await store.read(saved.id)).title, saved.title);
});

test('Settings history rejects local revision conflicts and cannot revive deleted records', async () => {
    const f = fixture(), saved = await f.store.create(record());
    const updated = await f.store.update({ ...saved, title: 'new' }, 1);
    await assert.rejects(f.store.update(saved, 1), /HISTORY_CONFLICT/);
    await assert.rejects(f.store.remove(saved.id, 1), /HISTORY_CONFLICT/);
    await f.store.remove(saved.id, updated.revision);
    await assert.rejects(f.store.update(updated, 2), /HISTORY_DELETED/);
    assert.equal(await f.store.read(saved.id), null);
});

test('Settings save failure rolls back only its projection and preserves unrelated edits', async () => {
    const wait = deferred(), f = fixture(() => wait.promise);
    const saving = f.store.create(record()); await Promise.resolve();
    f.settings.other = 'concurrent'; wait.reject(Error('private raw failure'));
    await assert.rejects(saving, /^Error: HISTORY_SAVE_FAILED$/);
    assert.equal(f.settings.muyuHistoryData, undefined); assert.equal(f.settings.other, 'concurrent');
    assert.deepEqual(await f.store.list(), []);
});

test('Settings history waits for saves before exposing persisted records and serializes ports', async () => {
    const wait = deferred(), f = fixture(() => wait.promise);
    const a = record(), b = record(), saving = f.store.create(a);
    await Promise.resolve();
    let resolved = false; const listing = f.store.list().then(value => { resolved = true; return value; });
    const second = openSettingsHistoryStore({ namespace, getSettings: () => f.settings, saveSettings: async () => {} });
    const savingB = second.create(b);
    await Promise.resolve(); assert.equal(resolved, false);
    wait.resolve(); await saving; await listing; await savingB;
    assert.equal((await second.list()).length, 2);
});

test('Settings replacement during save is retained instead of overwritten by rollback', async () => {
    const wait = deferred(), f = fixture(() => wait.promise), replacement = { version: 1, namespace, records: [] };
    const saving = f.store.create(record()); await Promise.resolve();
    f.settings.muyuHistoryData = replacement; wait.resolve();
    await assert.rejects(saving, /HISTORY_CONFLICT/); assert.equal(f.settings.muyuHistoryData, replacement);
});

test('Settings history rejects oversized and corrupt data without discarding originals', async () => {
    const f = fixture(), large = record();
    large.messages = Array.from({ length: 9 }, (_, i) => ({ role: 'user', content: 'x'.repeat(1024 * 1024 - 100), runId: String(i) }));
    assert.ok(JSON.stringify(large).length > SETTINGS_HISTORY_LIMITS.recordBytes);
    await assert.rejects(f.store.create(large), /HISTORY_CAPACITY/); assert.equal(f.settings.muyuHistoryData, undefined);
    f.settings.muyuHistoryData = { version: 99, namespace, records: [] };
    await assert.rejects(f.store.list(), /HISTORY_VERSION/); assert.equal(f.settings.muyuHistoryData.version, 99);
    f.settings.muyuHistoryData = { version: 1, namespace: crypto.randomUUID(), records: [] };
    await assert.rejects(f.store.list(), /HISTORY_INVALID/);
});

test('Settings history enforces aggregate capacity without deleting older conversations', async () => {
    const f = fixture();
    for (let n = 0; n < 4; n++) {
        const large = record();
        large.messages = Array.from({ length: 8 }, (_, i) => ({ role: 'user', content: 'x'.repeat(1024 * 1024 - 500), runId: String(i) }));
        await f.store.create(large);
    }
    const extra = record(); extra.messages = [{ role: 'user', content: 'y'.repeat(100000), runId: 'last' }];
    await assert.rejects(f.store.create(extra), /HISTORY_CAPACITY/);
    assert.equal((await f.store.list()).length, 4);
});

test('Account settings mode bypasses companion plugin and IndexedDB entirely', async () => {
    const settings = { muyuHistoryEnabled: true, muyuHistoryAccountStorage: true }; let calls = 0;
    const port = createHistoryPort({ getAccount: async () => ({ enabled: false }), getSettings: () => settings, saveSettings: async () => { calls++; },
        openStore: async () => { throw Error('must not open browser'); }, openServer: async () => { throw Error('must not probe server'); } });
    const store = await port.open(); await store.create(record());
    assert.equal(store.kind, 'account-settings'); assert.equal(calls, 1);
    await port.setAccountStorage(false); assert.equal(port.accountStorage(), false);
    assert.equal(store.kind, 'account-settings', 'selection changes only the next opened backend');
    assert.equal(settings.muyuHistoryData.records.length, 1, 'old data retained');
});

test('Account selection save failures preserve choice and account switches block access', async () => {
    const settings = { muyuHistoryAccountStorage: true }; let account = { enabled: false };
    const port = createHistoryPort({ getAccount: async () => account, getSettings: () => settings, saveSettings: async () => { throw Error('failed'); } });
    await assert.rejects(port.setAccountStorage(false), /HISTORY_SETTINGS_FAILED/); assert.equal(port.accountStorage(), true);
    const store = await port.open(); account = { enabled: true, handle: 'another', created: 1 };
    await assert.rejects(store.list(), /HISTORY_IDENTITY_UNAVAILABLE/);
    await assert.rejects(store.create(record()), /HISTORY_IDENTITY_UNAVAILABLE/); assert.equal(settings.muyuHistoryData, undefined);
    store.close();
});

test('Private history fields stay out of profile snapshots, exports, imports and application', async t => {
    const previous = globalThis.document;
    globalThis.document = { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } };
    t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
    const privateData = { marker: 'PRIVATE_HISTORY_MARKER' };
    const f = createConfigProfileSubject({ muyuHistoryAccountStorage: true, muyuHistoryData: privateData });
    const saved = f.subject.saveCurrentAsProfile('test', '', { agentsTools: true, contextLedger: true });
    assert.equal(Object.hasOwn(saved.settings, 'muyuHistoryData'), false);
    saved.settings.muyuHistoryData = { marker: 'INJECTED' }; saved.settings.muyuHistoryAccountStorage = false;
    assert.doesNotMatch(JSON.stringify(f.subject.exportProfileAsJson(saved.id)), /muyuHistoryData|muyuHistoryAccountStorage/);
    await f.subject.applyProfile(saved.id);
    assert.deepEqual(f.settings.muyuHistoryData, privateData); assert.equal(f.settings.muyuHistoryAccountStorage, true);
    assert.deepEqual(sanitizeImportedSettings({ muyuHistoryData: privateData, muyuHistoryAccountStorage: true }), {});
});
