import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('config profile apply handler reports failures before success refreshes', async () => {
    const source = await readFile(new URL('../../ui/sections/configProfiles.js', import.meta.url), 'utf8');
    const handler = source.slice(
        source.indexOf("$list.find('.gd-cfg-apply-btn')"),
        source.indexOf('// Export'),
    );

    assert.match(handler, /try\s*\{/);
    assert.match(handler, /sys\.applyProfile\(id, mergeMode\)/);
    assert.match(handler, /catch\s*\(e\)\s*\{[\s\S]*toastr\.error/);
    assert.ok(handler.indexOf('sys.applyProfile') < handler.indexOf('__gdRefreshDashboard'));
    assert.ok(handler.indexOf('__gdRefreshDashboard') < handler.indexOf('toastr.success'));
});
