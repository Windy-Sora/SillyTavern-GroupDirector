import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../index.js', import.meta.url), 'utf8');
const functionSource = source.slice(source.indexOf('async function getScriptForChar('), source.indexOf('\nfunction saveSettings()'));

test('disabled Director scripts neither render the wrapper nor update counters', async () => {
    const getScript = vm.runInNewContext(`${functionSource}\ngetScriptForChar`, {
        settings: { llmScriptEnabled: false },
    });
    assert.equal(await getScript('Alice'), '');
});
