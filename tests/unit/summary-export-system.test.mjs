import test from 'node:test';
import assert from 'node:assert/strict';

import { createSummaryExportSystem } from '../../systems/summary-export-system.js';

function installDownloadDom() {
    const original = { document: globalThis.document, URL: globalThis.URL };
    const anchor = { click() {} };
    globalThis.document = { createElement: () => anchor, body: { appendChild() {}, removeChild() {} } };
    globalThis.URL = { createObjectURL: () => 'blob:summary', revokeObjectURL() {} };
    return { anchor, restore() { globalThis.document = original.document; globalThis.URL = original.URL; } };
}

function fixture(overrides = {}) {
    const settings = { lang: 'en' };
    const metadata = {};
    const calls = { saved: 0 };
    const dependencies = {
        settings,
        EXT_KEY: 'gd',
        getChatMetadata: () => metadata,
        saveChatConditional: async () => calls.saved++,
        getCurrentGroup: () => ({ name: 'Campaign' }),
        defaultSummaryPrompt: 'summarize',
        chatSummarySystem: { getLatestActive: () => ({ content: 'The party arrived.', timestamp: 10 }) },
        log: () => {},
        ...overrides,
    };
    return { system: createSummaryExportSystem(dependencies), metadata, calls };
}

test('summary export returns null without content and downloads an active summary', () => {
    const empty = fixture({ chatSummarySystem: { getLatestActive: () => null } }).system;
    assert.equal(empty.exportActiveSummary(), null);

    const dom = installDownloadDom();
    try {
        const { system } = fixture();
        const data = system.exportActiveSummary('Session 1');
        assert.equal(data.summary.content, 'The party arrived.');
        assert.equal(data.template.summaryPrompt, 'summarize');
        assert.match(dom.anchor.download, /^summary-Session_1-/);
    } finally { dom.restore(); }
});

test('summary import validates the envelope and manages imported entries', async () => {
    const { system, calls } = fixture();
    assert.equal(system.parseImportFile('{').ok, false);
    assert.equal(system.parseImportFile('{}').ok, false);
    const data = { version: 1, type: 'summary-export', source: { groupName: 'Old Group' }, template: { summaryPrompt: 'old' }, summary: { content: 'Previously...' } };
    assert.equal(system.parseImportFile(JSON.stringify(data)).ok, true);

    const entry = await system.addImportedSummary(data);
    assert.equal(entry.name, 'Old Group');
    assert.equal(entry.enabled, true);
    await system.updateImportedSummary(entry.id, { name: 'Renamed' });
    await system.setEnabled(entry.id, false);
    assert.equal(system.renderEnabledSummaries().content, '');
    await system.setEnabled(entry.id, true);
    const rendered = system.renderEnabledSummaries();
    assert.equal(rendered.data.count, 1);
    assert.deepEqual(rendered.data.names, ['Renamed']);
    assert.match(rendered.content, /Previously/);
    await system.deleteImportedSummary(entry.id);
    assert.equal(system.getImportedSummaries().length, 0);
    assert.equal(calls.saved, 5);
});

test('summary updates and deletes ignore unknown identifiers', async () => {
    const { system, calls } = fixture();
    await system.updateImportedSummary('missing', { enabled: false });
    await system.deleteImportedSummary('missing');
    assert.equal(calls.saved, 0);
});
