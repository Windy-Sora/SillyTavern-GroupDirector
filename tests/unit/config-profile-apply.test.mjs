import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfigProfileSubject } from './helpers/config-profile-subject.mjs';

function profile(settings, extra = {}) {
    return {
        id: 'profile-1',
        name: 'Profile',
        drawers: {},
        settings,
        ...extra,
    };
}

test('applying a profile merges defaults and preserves per-user agent credentials', () => {
    const { subject, settings, calls, extensionSettings } = createConfigProfileSubject({
        profileLibraryAutoLoad: { enabled: false, fixedId: 'old' },
        configProfiles: [profile({
            llmMaxSpeakers: 4,
            profileLibraryAutoLoad: { enabled: true },
            agentConfigs: { director: { apiKey: 'replace-me' } },
            userProviders: [{ name: 'provider', source: 'export default {}' }],
            userCapabilities: [{ name: 'capability', source: 'export default {}' }],
        })],
    });

    const result = subject.applyProfile('profile-1');

    assert.equal(settings.llmMaxSpeakers, 4);
    assert.equal(settings.profileLibraryAutoLoad.enabled, true);
    assert.equal(settings.profileLibraryAutoLoad.mode, 'best');
    assert.equal(settings.agentConfigs.director.apiKey, 'keep-me');
    assert.equal(settings.userProviders[0].name, 'provider');
    assert.equal(settings.userCapabilities[0].name, 'capability');
    assert.ok(result.changed.includes('llmMaxSpeakers'));
    assert.equal(calls.saves, 1);
    assert.equal(extensionSettings.gd, settings);
});

test('custom prompt merge modes have isolated replace, keep, and skip semantics', () => {
    for (const [mode, expected] of [
        ['replace', ['new existing', 'new extra']],
        ['keep', ['old existing', 'new extra']],
        ['skip', ['old existing']],
    ]) {
        const { subject, settings } = createConfigProfileSubject({
            customPrompts: [{ name: 'same', content: 'old existing' }],
            configProfiles: [profile({ customPrompts: [
                { name: 'same', content: 'new existing' },
                { name: 'extra', content: 'new extra' },
            ] })],
        });
        const result = subject.applyProfile('profile-1', mode);
        assert.deepEqual(settings.customPrompts.map(item => item.content), expected);
        assert.deepEqual(result.customPromptConflicts, ['same']);
    }
});

test('variable rejection leaves settings unchanged and does not save', () => {
    const { subject, settings, calls } = createConfigProfileSubject({
        llmMaxSpeakers: 1,
        configProfiles: [profile({ llmMaxSpeakers: 5 }, {
            drawers: { contextLedger: true },
            variables: { defs: [], values: { global: {}, character: {} } },
        })],
    }, { ok: false, error: 'invalid variables' });
    const before = structuredClone(settings);

    assert.throws(() => subject.applyProfile('profile-1'), /Variable import failed/);
    assert.deepEqual(settings, before);
    assert.equal(calls.saves, 0);
    assert.equal(calls.logs.length, 0);
});

test('malformed stored profiles fail before any live state mutation', () => {
    const { subject, settings, calls } = createConfigProfileSubject({
        configProfiles: [profile({ customPrompts: [null] })],
    });
    const before = structuredClone(settings);

    assert.throws(() => subject.applyProfile('profile-1'), /customPrompts\[0\]/);
    assert.deepEqual(settings, before);
    assert.equal(calls.saves, 0);
});

test('save failure rolls live settings back to their previous values', () => {
    const { subject, settings, calls } = createConfigProfileSubject({
        llmMaxSpeakers: 1,
        configProfiles: [profile({ llmMaxSpeakers: 5 })],
    }, { ok: true }, { saveError: new Error('disk unavailable') });
    const before = structuredClone(settings);

    assert.throws(() => subject.applyProfile('profile-1'), /disk unavailable/);
    assert.deepEqual(settings, before);
    assert.equal(calls.saves, 1);
    assert.equal(calls.logs.length, 0);
});
