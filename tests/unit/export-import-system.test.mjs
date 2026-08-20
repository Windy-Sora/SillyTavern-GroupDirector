import test from 'node:test';
import assert from 'node:assert/strict';

import { createExportImportSystem } from '../../systems/export-import-system.js';

function installBrowser(JSZipClass) {
    const original = {
        window: globalThis.window,
        document: globalThis.document,
        URL: globalThis.URL,
        fetch: globalThis.fetch,
    };
    const notices = { warning: [], error: [], success: [], info: [] };
    const toastr = Object.fromEntries(Object.keys(notices).map(level => [level, message => notices[level].push(message)]));
    const anchor = { clicked: 0, click() { this.clicked++; } };
    globalThis.window = { JSZip: JSZipClass, toastr };
    globalThis.document = {
        createElement: () => anchor,
        head: { appendChild() {} },
        body: { appendChild() {}, removeChild() {} },
    };
    globalThis.URL = { createObjectURL: () => 'blob:zip', revokeObjectURL() {} };
    return {
        notices,
        anchor,
        restore() {
            globalThis.window = original.window;
            globalThis.document = original.document;
            globalThis.URL = original.URL;
            globalThis.fetch = original.fetch;
        },
    };
}

class ExportZip {
    static latest;
    constructor() {
        ExportZip.latest = this;
        this.rootFiles = new Map();
        this.folderFiles = new Map();
    }
    file(name, value) { this.rootFiles.set(name, value); return this; }
    folder(name) {
        if (!this.folderFiles.has(name)) this.folderFiles.set(name, new Map());
        return { file: (fileName, value) => this.folderFiles.get(name).set(fileName, value) };
    }
    async generateAsync() { return new Blob(['zip']); }
}

function createSystem(overrides = {}) {
    return createExportImportSystem({
        settings: { lang: 'en' },
        getCurrentGroup: () => ({
            name: 'Test / Group',
            members: ['alice.png', 'disabled.png'],
            disabled_members: ['disabled.png'],
            activation_strategy: 1,
            generation_mode: 0,
        }),
        getChat: () => [],
        characters: [],
        world_names: ['Primary', 'Selected', 'Lore'],
        selected_world_info: ['Selected', 'Missing'],
        world_info: { charLore: [{ name: 'Lore' }, { name: 'Primary' }] },
        getChatMetadata: () => ({ world_info: 'Primary' }),
        log: () => {},
        ...overrides,
    });
}

test('group export collects unique active books and packages enabled characters', async () => {
    const browser = installBrowser(ExportZip);
    const requests = [];
    try {
        globalThis.fetch = async (url, options = {}) => {
            requests.push([url, options]);
            if (url === '/csrf-token') return { json: async () => ({ token: 'csrf' }) };
            if (url === '/api/characters/export') return { ok: true, blob: async () => new Blob(['character']) };
            if (url === '/api/worldinfo/get') return { ok: true, json: async () => ({ entries: {} }) };
            throw new Error(`Unexpected URL: ${url}`);
        };
        const system = createSystem();
        assert.deepEqual(system.getActivatedWorldBooks(), ['Primary', 'Selected', 'Lore']);
        await system.exportGroup();

        assert.equal(ExportZip.latest.folderFiles.get('characters').size, 1);
        assert.equal(ExportZip.latest.folderFiles.get('worlds').size, 3);
        assert.ok(ExportZip.latest.rootFiles.has('group.json'));
        assert.equal(requests.filter(([url]) => url === '/csrf-token').length, 1);
        assert.equal(requests.slice(1).every(([, options]) => options.headers['X-CSRF-Token'] === 'csrf'), true);
        assert.match(browser.anchor.download, /^group_export_Test _ Group\.zip$/);
        assert.equal(browser.notices.success.length, 1);
    } finally { browser.restore(); }
});

test('group export stops cleanly outside group chat', async () => {
    const browser = installBrowser(ExportZip);
    try {
        await createSystem({ getCurrentGroup: () => null }).exportGroup();
        assert.equal(browser.notices.warning.length, 1);
    } finally { browser.restore(); }
});

test('group import remaps renamed character files before creating the group', async () => {
    const characterFile = { name: 'characters/alice.png', async: async () => new Blob(['character']) };
    const worldFile = { name: 'worlds/Primary.json', async: async () => new Blob(['world']) };
    const groupFile = {
        async: async () => JSON.stringify({
            name: 'Imported',
            members: ['alice.png'],
            disabled_members: [],
            activation_strategy: 2,
        }),
    };
    const loadedZip = {
        folder(name) {
            if (name === 'characters') return { file: () => [characterFile] };
            if (name === 'worlds') return { file: () => [worldFile] };
            return null;
        },
        file: name => name === 'group.json' ? groupFile : null,
    };
    class ImportZip { static async loadAsync() { return loadedZip; } }

    const browser = installBrowser(ImportZip);
    let createBody;
    try {
        globalThis.fetch = async (url, options = {}) => {
            if (url === '/csrf-token') return { json: async () => ({ token: 'csrf' }) };
            if (url === '/api/characters/import') return { ok: true, json: async () => ({ file_name: 'alice_1' }) };
            if (url === '/api/worldinfo/import') return { ok: true };
            if (url === '/api/groups/create') {
                createBody = JSON.parse(options.body);
                return { ok: true, json: async () => ({ id: 'g2' }) };
            }
            throw new Error(`Unexpected URL: ${url}`);
        };
        await createSystem().importGroup(new ArrayBuffer(2));
        assert.deepEqual(createBody.members, ['alice_1.png']);
        assert.equal(browser.notices.success.length, 1);
        assert.equal(browser.notices.info.length, 1);
    } finally { browser.restore(); }
});
