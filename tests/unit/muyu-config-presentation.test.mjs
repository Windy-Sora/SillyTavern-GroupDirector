import test from 'node:test';
import assert from 'node:assert/strict';
import { configFields, configDomains, fieldDefinition } from '../../muyu/config/registry.js';
import { configPresentation, configLabel, configValue, configDiffText } from '../../muyu/config/presentation.js';
import { uiLabel } from '../../ui/i18n.js';
import { createSettingsModule } from '../../muyu/modules/settings/index.js';
import { DEFAULT_SETTINGS } from '../../settings.js';
import { renderConfigDiff } from '../../muyu/ui/config-diff-view.js';
import { receiptText } from '../../muyu/actions/receipts.js';
import { diagnosticPresentation, readPresentationSchema, memoryConfigPresentation, settingDisplayValues } from '../../muyu/config/read-presentation.js';
import { validateJson } from '../../muyu/core/json-contract.js';

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

test('Config contracts bound inference without changing values or write schemas', () => {
    const target = { kind: 'global', userKey: 'test' };
    const module = createSettingsModule({ getTarget: () => target, getSettings: () => DEFAULT_SETTINGS });
    const result = JSON.parse(module.handlers['muyu.settings.contract']({ fields: ['llmMaxSpeakers', 'autoMemoryEnabled'] }, { target, signal: new AbortController().signal }).text);
    assert.match(result[0].description, /上限.*不是实际选择结果/);
    assert.match(result[1].description, /自动提取关闭只停用自动提取路径/);
    assert.deepEqual(result[0].schema, { type: 'integer', minimum: 1, maximum: 20 });
    assert.deepEqual(result[1].schema, { type: 'boolean' });
    module.dispose();
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
    assert.equal(JSON.parse(read.text).displayValues.memoryEnabled.zh, configValue('memoryEnabled', DEFAULT_SETTINGS.memoryEnabled));
    for (const result of [catalog, read, ...configDomains.map(domain => module.handlers['muyu.settings.contract']({ domain }, ctx))]) {
        assert.ok(result.text.length <= 24000);
        assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 32768);
    }
    module.dispose();
});

test('Diagnostic names reuse GUI labels while runtime facts cannot masquerade as settings', () => {
    const state = { mode: 'llm', respectOrder: 'off', interval: 15, speakersOnly: 'on', lastChatLength: -1, roundActive: 'off', baselineSource: 'legacy', members: [{ slot: 0, intervalStatus: 'pending' }] };
    const before = structuredClone(state), rows = diagnosticPresentation(state);
    validateJson(readPresentationSchema, rows);
    const row = field => rows.find(r => r.field === field);
    assert.equal(row('mode').value.zh, configValue('mode', 'llm'));
    assert.equal(row('respectOrder').label.zh, configLabel('llmRespectOrder'));
    assert.equal(row('respectOrder').value.zh, '关闭');
    assert.equal(row('interval').value.zh, configValue('autoMemoryInterval', 15));
    assert.equal(row('roundActive').kind, 'runtime'); assert.equal(row('roundActive').section.zh, '');
    assert.equal(row('lastChatLength').value.zh, '未知');
    assert.equal(row('baselineSource').value.en, 'Legacy record');
    assert.ok(row('members.intervalStatus'));
    assert.deepEqual(state, before);
    assert.deepEqual(diagnosticPresentation(JSON.parse('{"__proto__":"x","constructor":"x"}')), []);
    assert.equal(diagnosticPresentation({ mode: 'off' })[0].value.zh, configValue('mode', 'off'));
});

test('Display annotations preserve raw config states and avoid repeating Prompt bodies', () => {
    const fields = [{ field: 'memoryEnabled', state: 'value', value: 'false' }, { field: 'autoMemoryEnabled', state: 'missing', value: '' }, { field: 'autoMemoryInterval', state: 'unsupported', value: '' }];
    const before = structuredClone(fields), rows = memoryConfigPresentation({ fields });
    validateJson(readPresentationSchema, rows);
    assert.equal(rows[0].value.zh, '关闭'); assert.equal(rows[1].value.zh, '缺失／未读取');
    assert.match(rows[2].value.zh, /不受支持/); assert.deepEqual(fields, before);
    const values = { mode: 'llm', memoryEnabled: false, llmPrompt: 'LONG_PRIVATE_BODY'.repeat(1000), providerTimeoutMs: 10000 };
    const display = settingDisplayValues(values);
    assert.equal(display.providerTimeoutMs.zh, '10 秒'); assert.equal(display.mode.en, configValue('mode', 'llm', 'en'));
    assert.equal(Object.hasOwn(display, 'llmPrompt'), false);
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
