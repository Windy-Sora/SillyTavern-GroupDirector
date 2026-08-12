import assert from 'node:assert/strict';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateChecker } from '../../tools/gd-test/core/check-contract.mjs';
import { discoverCheckers } from '../../tools/gd-test/core/check-discovery.mjs';
import { runCheckers } from '../../tools/gd-test/core/check-runner.mjs';

async function fixture(t) {
    const directory = await mkdtemp(path.join(tmpdir(), 'gd-checkers-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    return {
        directory,
        write: (name, source) => writeFile(path.join(directory, `${name}.check.mjs`), source),
    };
}

const declaration = (id, order, run = 'return {};', extra = '') => `
export default {
    id: '${id}', title: '${id}', version: 1, order: ${order}, ${extra}
    async run() { ${run} },
};
`;

const context = { project: { root: '', config: {} } };

test('checker contract rejects malformed declarations and worker results', async t => {
    assert.throws(() => validateChecker({}, 'bad.check.mjs'), /invalid id/);
    assert.throws(() => validateChecker({ id: 'Bad ID', title: 'bad', version: 1, run() {} }), /invalid id/);

    const files = await fixture(t);
    await files.write('invalid-result', declaration('invalid-result', 1, "return { issues: [{ severity: 'fatal' }] };"));
    const result = await runCheckers(await discoverCheckers(files.directory), context);
    assert.equal(result.issues[0].code, 'CHECK_CRASH');
    assert.match(result.issues[0].message, /invalid issue severity/);
});

test('checker runner uses deterministic order and isolates crashes', async t => {
    const files = await fixture(t);
    await files.write('second', declaration('second', 20, 'return { counts: { second: 1 } };'));
    await files.write('crashing', declaration('crashing', 10, "throw new Error('boom');"));
    await files.write('first', declaration('first', 10));
    const checkers = await discoverCheckers(files.directory);

    assert.deepEqual(checkers.map(item => item.id), ['crashing', 'first', 'second']);
    const result = await runCheckers(checkers, context);
    assert.equal(result.issues.some(issue => issue.code === 'CHECK_CRASH'), true);
    assert.deepEqual(result.counts, { second: 1 });
    assert.equal(result.checkers.length, 3);
});

test('timed-out checker workers are terminated before the runner advances', async t => {
    const files = await fixture(t);
    const marker = path.join(files.directory, 'late-side-effect.txt').replaceAll('\\', '\\\\');
    await files.write('slow', `
import { writeFile } from 'node:fs/promises';
export default {
    id: 'slow', title: 'slow', version: 1, order: 1, timeoutMs: 10,
    async run() {
        await new Promise(resolve => setTimeout(resolve, 80));
        await writeFile('${marker}', 'late');
        return {};
    },
};
`);
    await files.write('next', declaration('next', 2, 'return { counts: { next: 1 } };'));

    const result = await runCheckers(await discoverCheckers(files.directory), context);
    assert.equal(result.issues[0].code, 'CHECK_TIMEOUT');
    assert.deepEqual(result.counts, { next: 1 });
    await new Promise(resolve => setTimeout(resolve, 120));
    await assert.rejects(access(path.join(files.directory, 'late-side-effect.txt')), { code: 'ENOENT' });
});

test('checker runner rejects duplicate count ownership', async t => {
    const files = await fixture(t);
    await files.write('one', declaration('one', 1, 'return { counts: { shared: 1 } };'));
    await files.write('two', declaration('two', 2, 'return { counts: { shared: 2 } };'));
    await assert.rejects(runCheckers(await discoverCheckers(files.directory), context), /Duplicate checker count key/);
});

test('checker discovery scans check files and rejects duplicate IDs', async t => {
    const files = await fixture(t);
    await files.write('later', declaration('later', 20));
    await files.write('first', declaration('first', 10));
    await writeFile(path.join(files.directory, 'ignored.mjs'), declaration('ignored', 0));
    assert.deepEqual((await discoverCheckers(files.directory)).map(item => item.id), ['first', 'later']);

    await files.write('duplicate', declaration('first', 30));
    await assert.rejects(discoverCheckers(files.directory), /Duplicate checker id "first"/);
});
