import test from 'node:test';
import assert from 'node:assert/strict';

import { createProfileLibrarySystem } from '../../systems/profile-library-system.js';

function fixture(overrides = {}) {
    const settings = {};
    const extension_settings = {};
    const calls = { saved: 0, chatSaved: 0, applied: [], refreshed: 0 };
    const characters = [
        { avatar: 'alice.png', name: 'Alice', description: 'a', personality: 'p', scenario: 's' },
        { avatar: 'bob.png', name: 'Bob', description: 'b', personality: 'p', scenario: 's' },
    ];
    const dependencies = {
        settings,
        extension_settings,
        EXT_KEY: 'group-director',
        saveSettings: () => calls.saved++,
        saveChatConditional: async () => calls.chatSaved++,
        getProfiles: () => ({
            'alice.png': { state: 'ready', hash: 'a|p|s', profile: { role: 'lead' } },
            'bob.png': { state: 'ready', hash: 'b|p|s', profile: { role: 'support' } },
        }),
        getCurrentGroup: () => ({ id: 'g1', name: 'Party', members: ['alice.png', 'bob.png'], disabled_members: [] }),
        getCharacters: () => characters,
        getDefaultProfileGeneratorPrompt: () => 'default prompt',
        getDefaultProfileSchema: () => ({ type: 'object' }),
        getDefaultProfileRenderTemplate: () => '{{role}}',
        parseImportFile: text => ({ ok: true, data: JSON.parse(text) }),
        applyImport: async (...args) => { calls.applied.push(args); return { applied: args[1].length }; },
        refreshProfileManagementUI: () => calls.refreshed++,
        hashChar: (description, personality, scenario) => `${description}|${personality}|${scenario}`,
        log: () => {},
        ...overrides,
    };
    return { system: createProfileLibrarySystem(dependencies), settings, extension_settings, calls, characters };
}

test('profile library saves ready profiles and maintains auto-load settings', () => {
    const { system, settings, extension_settings, calls } = fixture();
    assert.throws(() => system.saveCurrentAsLibrary('  '), /name is required/i);

    const entry = system.saveCurrentAsLibrary('Main / Cast', 'campaign');
    assert.equal(entry.profileCount, 2);
    assert.equal(entry.exportData.source.groupName, 'Party');
    assert.equal(entry.exportData.template.generatorPrompt, 'default prompt');
    assert.equal(entry.exportData.profiles[0].name, 'Alice');
    assert.equal(extension_settings['group-director'], settings);
    assert.equal(calls.saved, 1);

    const auto = system.getAutoLoadSettings();
    assert.equal(auto.mode, 'best');
    auto.enabled = true;
    auto.mode = 'fixed';
    auto.fixedId = entry.id;
    assert.equal(system.deleteLibrary(entry.id), true);
    assert.equal(auto.enabled, false);
    assert.equal(auto.fixedId, '');
    assert.equal(system.deleteLibrary('missing'), false);
});

test('profile library matches without reusing profiles and applies translated avatars', async () => {
    const { system, settings, calls } = fixture();
    const entry = system.saveCurrentAsLibrary('Cast');
    settings.profileLibraries[0].exportData.profiles[0].avatar = 'old-alice.png';

    const preview = system.matchLibraryProfiles(entry, { overwriteExisting: false });
    assert.deepEqual(preview.matches.map(match => match.matchType), ['hash', 'hash']);
    assert.equal(preview.matches.every(match => match.skipped), true);

    const skipped = await system.applyLibrary(entry.id);
    assert.equal(skipped.applied, 0);
    assert.equal(skipped.skipped, 2);

    const result = await system.applyLibrary(entry.id, { overwriteExisting: true, importTemplate: true });
    assert.equal(result.applied, 2);
    assert.deepEqual(calls.applied[0][1], ['alice.png', 'bob.png']);
    assert.deepEqual(calls.applied[0][2], { importTemplate: true });
    assert.equal(calls.applied[0][0].profiles[0].avatar, 'alice.png');
    assert.equal(calls.refreshed, 1);
    assert.equal(calls.chatSaved, 1);
    await assert.rejects(system.applyLibrary('missing'), /not found/i);
});

test('profile library imports, ranks matches, and deduplicates automatic loading', async () => {
    const { system, settings, calls } = fixture({ getProfiles: () => ({}) });
    const data = {
        version: 1,
        type: 'profile-export',
        source: { groupName: 'Imported Group', groupNote: 'notes' },
        libraryMeta: { name: 'Imported', description: 'desc' },
        profiles: [
            { avatar: 'alice.png', name: 'Alice', hash: 'a|p|s', profile: { role: 'lead' } },
            { avatar: 'bob.png', name: 'Bob', hash: 'b|p|s', profile: { role: 'support' } },
        ],
    };
    const entry = await system.importFileToLibrary({ name: 'fallback.json', text: async () => JSON.stringify(data) });
    assert.equal(entry.name, 'Imported');
    assert.equal(entry.profileCount, 2);
    assert.equal(system.findBestLibrary()?.entry.id, entry.id);

    Object.assign(system.getAutoLoadSettings(), { enabled: true, mode: 'best', overwriteExisting: true });
    const first = await system.autoLoadForCurrentGroup('chat');
    assert.equal(first.applied, 2);
    assert.equal((await system.autoLoadForCurrentGroup('chat')).reason, 'deduped');
    system.resetAutoLoadDedup();
    assert.equal((await system.autoLoadForCurrentGroup('chat')).applied, 2);
    assert.equal(calls.applied.length, 2);

    settings.profileLibraryAutoLoad.enabled = false;
    assert.equal((await system.autoLoadForCurrentGroup()).reason, 'disabled');
});

test('profile library reports invalid imports and empty sources', async () => {
    const empty = fixture({ getProfiles: () => ({}) }).system;
    assert.throws(() => empty.saveCurrentAsLibrary('Empty'), /No ready/i);

    const invalid = fixture({ parseImportFile: () => ({ ok: false, error: 'bad profile data' }) }).system;
    await assert.rejects(
        invalid.importFileToLibrary({ name: 'bad.json', text: async () => '{}' }),
        /bad profile data/,
    );
});
