import { relativePath } from '../lib/files.mjs';
import { runCommand } from '../lib/process.mjs';

export function parseTestSummary(output) {
    const number = label => {
        const match = new RegExp(`(?:^|\\n)[^\\n]*\\b${label}\\s+(\\d+)\\s*(?:\\n|$)`, 'i').exec(output);
        return match ? Number(match[1]) : null;
    };
    return {
        tests: number('tests'),
        pass: number('pass'),
        fail: number('fail'),
        skipped: number('skipped'),
        todo: number('todo'),
    };
}

export function parseBugCoverage(output, requiredIds = []) {
    const normalize = value => `BUG-${Number(value.replace(/^BUG-/i, ''))}`;
    const found = new Set([...output.matchAll(/\bBUG-(\d+)\b/gi)].map(match => `BUG-${Number(match[1])}`));
    const required = requiredIds.map(normalize);
    return {
        required,
        found: required.filter(id => found.has(id)),
        missing: required.filter(id => !found.has(id)),
    };
}

export function parseCoverageSummary(output) {
    const match = /(?:^|\n)[^\n]*\ball files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/i.exec(output);
    if (!match) return null;
    return {
        lines: Number(match[1]),
        branches: Number(match[2]),
        functions: Number(match[3]),
    };
}

export async function runNodeTests({ root, config, testEntries, options, requiredBugIds = [] }) {
    const files = testEntries.map(entry => entry.file);
    const args = ['--test', `--test-concurrency=${config.test.concurrency}`, '--test-reporter=spec'];
    const coverageIncludes = config.test.coverageIncludes || [
        '*.js',
        'agents/**/*.js',
        'assets/**/*.js',
        'systems/**/*.js',
        'ui/**/*.js',
        'utils/**/*.js',
    ];
    if (options.coverage) {
        args.push('--experimental-test-coverage');
        args.push(...coverageIncludes.map(pattern => `--test-coverage-include=${pattern}`));
    }
    if (options.filter && !files.some(file => relativePath(root, file).toLowerCase().includes(options.filter.toLowerCase()))) {
        args.push(`--test-name-pattern=${options.filter}`);
    }
    args.push(...files);
    const result = await runCommand(process.execPath, args, {
        cwd: root,
        env: { ...process.env, GD_TEST_ST_ROOT: options.stRoot, GD_TEST_SEED: options.seed },
        timeoutMs: config.test.timeoutMs,
        echo: options.verbose,
    });
    const output = `${result.stdout}${result.stderr}`;
    const bugCoverage = parseBugCoverage(output, requiredBugIds);
    return {
        name: 'tests',
        ok: result.code === 0 && !result.timedOut && bugCoverage.missing.length === 0,
        durationMs: result.durationMs,
        counts: parseTestSummary(output),
        exitCode: result.code,
        timedOut: result.timedOut,
        files: testEntries.map(entry => ({ suite: entry.suite, file: relativePath(root, entry.file) })),
        bugCoverage,
        coverage: options.coverage ? {
            includes: coverageIncludes,
            summary: parseCoverageSummary(output),
        } : null,
        output,
    };
}
