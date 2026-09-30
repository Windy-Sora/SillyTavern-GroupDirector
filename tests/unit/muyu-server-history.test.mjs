import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHistoryPort } from '../../muyu/host/history.js';
import { createMemoryHistoryStore } from '../../muyu/sessions/memory-store.js';
import { openServerHistoryStore } from '../../muyu/sessions/server-store.js';
import { validateRecord } from '../../muyu/sessions/contract.js';

const require = createRequire(import.meta.url);
const { createFileStore, init } = require('../../muyu/server-plugin/index.cjs');
const scope = JSON.stringify(['assistant', 'chat', 'A']);
const record = () => validateRecord({ version: 5, id: crypto.randomUUID(), revision: 0, scope, title: 'Hello', createdAt: 1, updatedAt: 1, messages: [{ role: 'user', content: 'Hello', runId: 'r' }], required: [], status: 'succeeded', archived: false, imported: false, contextSummary: null, receipts: [] });

test('Private file store persists, reloads, rejects stale writes and confines IDs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gd-muyu-store-'));
    try {
        const dir = path.join(root, '.group-director', 'muyu', 'history', crypto.randomUUID());
        const store = createFileStore(dir), input = record();
        const first = await store.create(input);
        assert.equal(first.revision, 1);
        assert.equal((await createFileStore(dir).read(input.id)).messages[0].content, 'Hello');
        assert.equal((await store.list())[0].count, 1);
        await assert.rejects(store.update({ ...input, title: 'stale' }, 0), /HISTORY_CONFLICT/);
        await assert.rejects(store.read('../other'), /HISTORY_INVALID/);
        await store.remove(input.id, 1);
        assert.equal(await store.read(input.id), null);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Server-store adapter falls back only for a missing plugin and migrates old browser records without deleting them', async () => {
    const browser = createMemoryHistoryStore(), old = record();
    await browser.create(old);
    const server = createMemoryHistoryStore();
    const port = createHistoryPort({ getAccount: async () => ({ enabled: false }), getSettings: () => ({ muyuHistoryEnabled: true }), saveSettings: async () => {},
        openStore: async () => browser, openServer: async () => server });
    const opened = await port.open();
    assert.equal((await opened.list()).length, 1);
    assert.equal((await server.read(old.id)).messages[0].content, 'Hello');
    assert.equal((await browser.read(old.id)).messages[0].content, 'Hello');
    const absent = await openServerHistoryStore({ namespace: crypto.randomUUID(), fetcher: async () => ({ status: 404 }) });
    assert.equal(absent, null);
});

test('Server plugin registers only its private authenticated API routes', () => {
    const routes = [];
    const router = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, (route) => routes.push(`${method} ${route}`)]));
    init(router);
    assert.deepEqual(routes, ['get /web/health', 'post /web/search', 'get /health', 'get /records', 'get /records/:id', 'put /records/:id', 'delete /records/:id']);
});

test('Deleting migrated history survives reopening and does not retain private text on the server', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gd-muyu-deleted-'));
    try {
        const browser = createMemoryHistoryStore(), old = record();
        await browser.create(old);
        const dir = path.join(root, 'history');
        const port = createHistoryPort({ getAccount: async () => ({ enabled: false }), getSettings: () => ({ muyuHistoryEnabled: true }), saveSettings: async () => {},
            openStore: async () => browser, openServer: async () => ({ ...createFileStore(dir), close() {} }) });
        const opened = await port.open();
        await opened.remove(old.id, (await opened.read(old.id)).revision);
        opened.close();
        const reopened = await port.open();
        assert.deepEqual(await reopened.list(), []);
        assert.equal(await reopened.read(old.id), null);
        assert.ok(await browser.read(old.id), 'migration backup stays intact');
        for (const name of await fs.readdir(dir)) assert.ok(!(await fs.readFile(path.join(dir, name), 'utf8')).includes('Hello'), 'deletion marker contains no conversation');
        const fresh = record(); await browser.create(fresh);
        assert.deepEqual((await (await port.open()).list()).map(row => row.id), [fresh.id], 'new browser histories can still migrate');
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Two tabs migrating the same browser history both open without overwriting the winner', async () => {
    const browser = createMemoryHistoryStore(), old = record(); await browser.create(old);
    const backing = createMemoryHistoryStore(); let listings = 0, release;
    const barrier = new Promise(resolve => { release = resolve; });
    const server = { ...backing, async list() { const rows = await backing.list(); if (++listings <= 2) { if (listings === 2) release(); await barrier; } return rows; } };
    const port = createHistoryPort({ getAccount: async () => ({ enabled: false }), getSettings: () => ({}), saveSettings: async () => {},
        openStore: async () => browser, openServer: async () => server });
    const opened = await Promise.all([port.open(), port.open()]);
    assert.equal(opened.length, 2); assert.equal((await backing.read(old.id)).revision, 1);
    assert.equal((await backing.list()).length, 1);
});

test('HTTP adapter writes and restores a private account file without exposing an arbitrary path', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gd-muyu-http-'));
    try {
        const routes = new Map(), router = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, (route, handler) => routes.set(`${method.toUpperCase()} ${route}`, handler)]));
        init(router);
        const fetcher = async (url, options) => new Promise(resolve => {
            const parsed = new URL(url, 'http://st.test'), id = parsed.pathname.split('/').at(-1);
            const route = id === 'health' ? '/health' : id === 'records' ? '/records' : '/records/:id';
            const handler = routes.get(`${options.method} ${route}`);
            if (!handler) return resolve({ status: 404 });
            const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { resolve({ status: this.statusCode, ok: this.statusCode < 400, json: async () => value }); } };
            handler({ user: { directories: { root } }, query: { namespace: parsed.searchParams.get('namespace') }, params: { id }, body: options.body ? JSON.parse(options.body) : undefined }, res);
        });
        const namespace = crypto.randomUUID(), store = await openServerHistoryStore({ namespace, fetcher });
        const input = record(), saved = await store.create(input);
        assert.equal(saved.revision, 1);
        assert.equal((await store.read(input.id)).messages[0].content, 'Hello');
        assert.equal((await store.list())[0].id, input.id);
        assert.equal((await fs.readdir(path.join(root, '.group-director', 'muyu', 'history', namespace))).length, 1);
        await store.remove(input.id, 1);
        assert.equal(await store.read(input.id), null);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
});
