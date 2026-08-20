import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import baseConfig from '../../gd-test.config.mjs';
import { parseOptions } from '../../tools/gd-test/core/options.mjs';
import { parseBugCoverage, parseCoverageSummary, parseTestSummary } from '../../tools/gd-test/core/test-runner.mjs';
import { writeJsonReport } from '../../tools/gd-test/reporters/json.mjs';

test('runner options preserve profile defaults and support both option forms', () => {
    assert.deepEqual(parseOptions([], {}), {
        profile: 'quick',
        filter: '',
        coverage: false,
        seed: '4674628',
        stRoot: '',
        report: '',
        list: false,
        verbose: false,
        help: false,
    });
    const options = parseOptions([
        'full', '--filter=memory', '--seed', '42', '--st-root=C:/ST',
        '--report', 'out.json', '--coverage', '--list', '--verbose',
    ], {});
    assert.equal(options.profile, 'full');
    assert.equal(options.filter, 'memory');
    assert.equal(options.seed, '42');
    assert.equal(options.stRoot, 'C:/ST');
    assert.equal(options.report, 'out.json');
    assert.equal(options.coverage, true);
    assert.equal(options.list, true);
    assert.equal(options.verbose, true);
    assert.throws(() => parseOptions(['--unknown'], {}), /Unknown argument/);
});

test('test output parsing keeps summary and historical contract semantics', () => {
    const output = '✔ BUG-2 works\nℹ tests 3\nℹ pass 2\nℹ fail 0\nℹ skipped 1\nℹ todo 0\n';
    assert.deepEqual(parseTestSummary(output), { tests: 3, pass: 2, fail: 0, skipped: 1, todo: 0 });
    assert.deepEqual(parseBugCoverage(output, ['BUG-2', 'BUG-3']), {
        required: ['BUG-2', 'BUG-3'],
        found: ['BUG-2'],
        missing: ['BUG-3'],
    });
});

test('coverage configuration spans every production area and parses Node summaries', () => {
    assert.deepEqual(baseConfig.test.coverageIncludes, [
        '*.js',
        'agents/**/*.js',
        'assets/**/*.js',
        'systems/**/*.js',
        'ui/**/*.js',
        'utils/**/*.js',
    ]);
    const output = [
        'start of coverage report',
        'all files | 67.35 | 72.89 | 68.61 |',
        'end of coverage report',
    ].join('\n');
    assert.deepEqual(parseCoverageSummary(output), {
        lines: 67.35,
        branches: 72.89,
        functions: 68.61,
    });
    assert.equal(parseCoverageSummary('coverage unavailable'), null);
});

test('JSON reporter writes the unchanged schema payload', async t => {
    const directory = await mkdtemp(path.join(tmpdir(), 'gd-report-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const report = { schemaVersion: 1, tool: 'gd-test-lab', ok: true, stages: [] };
    const output = await writeJsonReport(directory, 'nested/report.json', report);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), report);
});
