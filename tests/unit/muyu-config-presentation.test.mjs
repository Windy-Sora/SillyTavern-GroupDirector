import test from 'node:test';
import assert from 'node:assert/strict';
import { configFields, configDomains, fieldDefinition } from '../../muyu/config/registry.js';
import { configPresentation, configLabel, configValue, configDiffText } from '../../muyu/config/presentation.js';
import { uiLabel } from '../../ui/i18n.js';
import { createSettingsModule } from '../../muyu/modules/settings/index.js';
import { DEFAULT_SETTINGS } from '../../settings.js';
import { renderConfigDiff } from '../../muyu/ui/config-diff-view.js';
import { receiptText } from '../../muyu/actions/receipts.js';

test('Every editable setting has bilingual UI labels, sections and contract metadata', () => {
    for (const id of configFields) {
        const p = configPresentation(id);
        for (const lang of ['zh', 'en']) {
            assert.ok(p.label[lang], id); assert.ok(p.section[lang], id);
            assert.doesNotMatch(p.label[lang], /<[^>]*>/);
        }
        assert.deepEqual(fieldDefinition(id).presentation, p);
    }
    assert.equal(configLabel('critiqueEnabled'), uiLabel('critiqueEnabled'));
    assert.equal(configPresentation('__proto__'), null);
    assert.equal(configLabel('notRegistered'), '未登记的配置项');
});

test('Readable values retain empty, missing, null and text distinctions without default claims', () => {
    assert.equal(configValue('memoryEnabled', false), '关闭');
    assert.equal(configValue('memoryEnabled', 'true', 'en', { serialized: true }), 'On');
    assert.equal(configValue('llmPrompt', 'false'), 'false');
    assert.equal(configValue('llmPrompt', '"false"', 'zh', { serialized: true }), 'false');
    assert.equal(configValue('llmPrompt', ''), '空文本');
    assert.equal(configValue('llmPrompt', null), '空值（null）');
    assert.equal(configValue('llmPrompt', '(missing)', 'zh', { serialized: true }), '缺失／未读取');
    assert.equal(configValue('providerTimeoutMs', 10000), '10 秒');
    assert.equal(configValue('providerTimeoutMs', 0), '不限制超时');
    assert.equal(configValue('memoryMaxEntries', 10), '10 条');
    assert.equal(configValue('worldBookSourceMode', 'manual'), uiLabel('worldBookSourceManual'));
    assert.match(configValue('llmPrompt', 'a'.repeat(181)), /预览截断/);
    const diff = { field: 'memoryEnabled', before: 'false', after: 'true' }, before = structuredClone(diff);
    assert.equal(configDiffText(diff), `${uiLabel('memoryEnabled')}：关闭 → 开启`);
    assert.deepEqual(diff, before);
});

test('Catalog is host-independent and all-field reads/contracts stay inside tool output bounds', () => {
    let reads = 0; const target = { kind: 'global', userKey: 'test' };
    const module = createSettingsModule({ getTarget: () => target, getSettings: () => { reads++; return DEFAULT_SETTINGS; } });
    const ctx = { target, signal: new AbortController().signal };
    const catalog = module.handlers['muyu.settings.catalog']({}, ctx);
    assert.equal(reads, 0); assert.equal(JSON.parse(catalog.text).labels.memoryEnabled.zh, uiLabel('memoryEnabled'));
    const read = module.handlers['muyu.settings.read']({ fields: [...configFields] }, ctx);
    assert.equal(JSON.parse(read.text).values.memoryEnabled, DEFAULT_SETTINGS.memoryEnabled);
    for (const result of [catalog, read, ...configDomains.map(domain => module.handlers['muyu.settings.contract']({ domain }, ctx))]) {
        assert.ok(result.text.length <= 24000);
        assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 32768);
    }
    module.dispose();
});

test('GUI shows translated summaries and keeps exact unmodified fields in collapsed details', () => {
    const doc = { createElement: tag => ({ tag, children: [], append(el) { this.children.push(el); }, setAttribute() {} }) };
    const parent = doc.createElement('section');
    const diff = [{ field: 'memoryEnabled', before: 'false', after: 'true' }, { field: 'llmPrompt', before: '""', after: JSON.stringify('<script>' + 'a'.repeat(250)) }];
    const snapshot = structuredClone(diff);
    renderConfigDiff({ doc, parent, diff });
    assert.match(parent.children[0].textContent, /关闭 → 开启/);
    assert.doesNotMatch(parent.children[0].textContent, /memoryEnabled/);
    assert.match(parent.children[1].textContent, /预览截断/);
    const details = parent.children.at(-1); assert.equal(details.tag, 'details'); assert.ok(!details.open);
    assert.deepEqual(JSON.parse(details.children[1].textContent), diff);
    assert.deepEqual(diff, snapshot);
});

test('Historical config receipts translate labels without changing facts or raw records', () => {
    const r = { version: 2, at: 1, status: 'applied_unconfirmed', diff: [{ field: 'memoryEnabled', before: 'false', after: 'true' }], saveError: false, changed: false };
    const snapshot = structuredClone(r);
    for (const lang of ['zh', 'en']) {
        const text = receiptText(r, lang);
        assert.ok(text.includes(configLabel('memoryEnabled', lang)));
        assert.doesNotMatch(text, /memoryEnabled/);
        assert.match(text, lang === 'en' ? /persistence unconfirmed/ : /持久化保存未确认/);
    }
    assert.deepEqual(r, snapshot);
    const bundle = { version: 4, at: 1, status: 'partial', steps: [{ kind: 'variable', id: 'gold', status: 'applied_unconfirmed', chatSave: 'unconfirmed', diff: [{ field: 'defaultValue', before: '0', after: '10' }] }, { kind: 'settings', status: 'applied_unconfirmed', settingsSave: 'unconfirmed', diff: r.diff }] };
    const text = receiptText(bundle);
    assert.match(text, /defaultValue: 0 → 10/); assert.doesNotMatch(text, /memoryEnabled/);
    assert.ok(receiptText({ version: 5, at: 1, status: 'saved_unconfirmed', profileName: 'test', profileId: 'p', persistence: 'unconfirmed', fields: ['memoryEnabled'] }).includes(configLabel('memoryEnabled')));
});
