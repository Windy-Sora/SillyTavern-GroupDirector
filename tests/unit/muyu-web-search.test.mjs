import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createWebSearchPort } from '../../muyu/host/web-search.js';
import { createWebSearchModule } from '../../muyu/modules/web/index.js';
import { WEB_DEFAULTS, WEB_TOOL, webBytes, webResult } from '../../muyu/web/contract.js';

const require = createRequire(import.meta.url);
const { createWebSearchService } = require('../../muyu/server-plugin/web-search.cjs');
const input = { provider: 'brave', apiKey: 'PRIVATE_SEARCH_KEY', query: 'SillyTavern docs', maxResults: 5 };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const upstream = { type: 'search', web: { results: [{ title: 'Documentation', url: 'https://docs.example.test/st', description: 'Public source' }] } };
const result = () => ({ ...webResult('ok', 'query'), fetchedAt: new Date().toISOString(), results: [{ title: 'Docs', url: 'https://docs.example.test/', snippet: 'Public content' }] });

test('Search service uses the fixed Brave endpoint, never fetches result URLs and filters unsafe links', async () => {
    const calls = [];
    const service = createWebSearchService({ fetcher: async (url, options) => { calls.push({ url, options }); return response({ type: 'search', web: { results: [...upstream.web.results, { title: 'Bad', url: 'javascript:alert(1)' }, { title: 'Private', url: 'https://user:pass@example.test' }, upstream.web.results[0]] } }); } });
    const value = await service.search({ ...input, query: 'https://127.0.0.1/private', freshness: 'week' }, { account: 'A' });
    assert.equal(calls.length, 1); const url = new URL(calls[0].url);
    assert.equal(url.origin, 'https://api.search.brave.com'); assert.equal(url.searchParams.get('freshness'), 'pw');
    assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.headers['X-Subscription-Token'], input.apiKey);
    assert.equal(value.results.length, 1); assert.ok(!JSON.stringify(value).includes(input.apiKey));
    await assert.rejects(service.search({ ...input, apiKey: 'bad\nkey' }, { account: 'A' }), /INVALID/);
    assert.equal(calls.length, 1);
});

test('Search errors are normalized without exposing upstream bodies or credentials', async () => {
    for (const [status, expected] of [[401, 'auth_error'], [403, 'auth_error'], [429, 'rate_limit'], [500, 'unavailable']]) {
        const service = createWebSearchService({ fetcher: async () => response({ secret: input.apiKey }, status) });
        const value = await service.search(input, { account: 'A' }); assert.equal(value.status, expected); assert.deepEqual(value.results, []); assert.ok(!JSON.stringify(value).includes(input.apiKey));
    }
    const service = createWebSearchService({ fetcher: async () => response({ unexpected: true }) });
    assert.equal((await service.search(input, { account: 'A' })).status, 'invalid_response');
});

test('Deadline cancels upstream fetch and releases account concurrency capacity', async () => {
    let aborted = false;
    const service = createWebSearchService({ timeoutMs: 10, fetcher: (_url, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { aborted = true; reject(Error('SECRET')); }, { once: true }); }) });
    const value = await service.search(input, { account: 'A' }); assert.equal(value.status, 'timeout'); assert.equal(aborted, true);
    assert.equal((await service.search(input, { account: 'A' })).status, 'timeout');
});

test('Host key is optional to persist, excluded from snapshots, and sent only to the local plugin', async () => {
    const settings = {}, requests = [];
    const port = createWebSearchPort({ getSettings: () => settings, saveSettings: async () => {}, getHeaders: () => ({ 'X-CSRF-Token': 'CSRF' }), fetcher: async (url, options) => { requests.push({ url, options }); return response(url.endsWith('/health') ? { version: 1 } : result()); } });
    await port.save({ config: WEB_DEFAULTS, apiKey: input.apiKey, rememberKey: false });
    assert.equal(settings.agentConfigs['muyu-web-search'], undefined); assert.equal(port.describe().hasKey, true);
    assert.ok(!JSON.stringify(port.describe()).includes(input.apiKey));
    await port.check(); const captured = port.capture();
    await captured.search({ query: 'query' }, new AbortController().signal);
    assert.equal(requests[1].url, '/api/plugins/gd-muyu-history/web/search');
    assert.equal(JSON.parse(requests[1].options.body).apiKey, input.apiKey); assert.equal(requests[1].options.headers['X-CSRF-Token'], 'CSRF');
    await port.save({ config: WEB_DEFAULTS, apiKey: '', rememberKey: true }); assert.equal(settings.agentConfigs['muyu-web-search'].apiKey, input.apiKey);
    await port.forgetKey(); assert.equal(port.describe().hasKey, false); assert.equal(settings.agentConfigs['muyu-web-search'], undefined);
});

test('Failed settings save rolls back and missing plugin is explicit', async () => {
    const settings = {}, port = createWebSearchPort({ getSettings: () => settings, saveSettings: async () => { throw Error('PRIVATE'); } });
    await assert.rejects(port.save({ config: WEB_DEFAULTS, apiKey: input.apiKey, rememberKey: true }), /SAVE_FAILED/);
    assert.equal(settings.muyuWebSearchConfig, undefined); assert.equal(settings.agentConfigs['muyu-web-search'], undefined); assert.equal(port.describe().hasKey, false);
    const missing = createWebSearchPort({ getSettings: () => ({ agentConfigs: { 'muyu-web-search': { apiKey: input.apiKey } } }), saveSettings: async () => {}, fetcher: async () => response({}, 404) });
    await assert.rejects(missing.check(), /BACKEND_MISSING/); assert.equal(missing.describe().backend, 'missing');
});

test('Closing network access aborts the local request rather than racing away from it', async () => {
    let aborted = false, started;
    const pending = new Promise(resolve => { started = resolve; });
    const port = createWebSearchPort({ getSettings: () => ({ agentConfigs: { 'muyu-web-search': { apiKey: input.apiKey } } }), saveSettings: async () => {}, fetcher: (_url, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { aborted = true; reject(Error('cancelled')); }); started(); }) });
    const work = port.capture().search({ query: 'query' }, new AbortController().signal);
    await pending; port.cancel(); assert.equal((await work).status, 'network_error'); assert.equal(aborted, true);
});

test('Search limits survive task handoffs and large snippets stay within the byte budget', async () => {
    const module = createWebSearchModule(); let calls = 0, allowed = true;
    const capture = { limits: { maxSearches: 1, maxResults: 5, resultBytes: 2000 }, search: async () => { calls++; const value = result(); value.results[0].snippet = '中'.repeat(1200); return value; } };
    module.bindRun({ id: 'first' }, { webSearch: capture, webAllowed: () => allowed });
    const ctx = { runId: 'first', signal: new AbortController().signal }, search = module.handlers[WEB_TOOL];
    const value = await search({ query: 'query' }, ctx); assert.equal(value.status, 'ok'); assert.equal(value.truncated, true); assert.ok(webBytes(value) <= 2000);
    module.transferRun('first', { id: 'second' });
    assert.equal((await search({ query: 'another' }, { ...ctx, runId: 'second' })).status, 'budget_exceeded'); assert.equal(calls, 1);
    allowed = false; assert.equal((await search({ query: 'another' }, { ...ctx, runId: 'second' })).status, 'disabled'); module.dispose();
});
