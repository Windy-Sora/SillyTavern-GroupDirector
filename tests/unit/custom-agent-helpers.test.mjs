import assert from 'node:assert/strict';
import test from 'node:test';
import {
    matchesDataId,
    normalizeImportedAgent,
    toBoundedInt,
} from '../../ui/sections/custom-agent-helpers.js';

test('Custom Agent import keeps only approved fields and uses the trusted ID', () => {
    const normalized = normalizeImportedAgent({
        id: 'attacker"] .gd-ca-del-btn',
        name: '  Audit Agent  ',
        providerName: '  audit_result  ',
        prompt: 'inspect',
        schema: '{}',
        enabled: true,
        autoEnabled: true,
        autoInterval: 25,
        order: 7,
        unexpected: '<img src=x onerror=alert(1)>',
    }, 'ca_trusted');

    assert.deepEqual(normalized, {
        id: 'ca_trusted',
        name: 'Audit Agent',
        providerName: 'audit_result',
        prompt: 'inspect',
        schema: '{}',
        enabled: false,
        autoEnabled: false,
        autoInterval: 25,
        order: 7,
    });
    assert.equal(Object.hasOwn(normalized, 'unexpected'), false);
});

test('Custom Agent numeric fields are bounded and invalid values use defaults', () => {
    assert.equal(toBoundedInt(-5, 10, 1, 200), 1);
    assert.equal(toBoundedInt(500, 10, 1, 200), 200);
    assert.equal(toBoundedInt('bad', 10, 1, 200), 10);

    const normalized = normalizeImportedAgent({
        name: 'A',
        providerName: 'a',
        autoInterval: 'Infinity',
        order: 5000,
    }, 'ca_safe');
    assert.equal(normalized.autoInterval, 10);
    assert.equal(normalized.order, 999);
});

test('Custom Agent data-id matching treats selector syntax as plain text', () => {
    const malicious = 'x"] .gd-ca-del-btn, [data-id="y';
    assert.equal(matchesDataId(malicious, malicious), true);
    assert.equal(matchesDataId('x', malicious), false);
    assert.equal(matchesDataId(undefined, malicious), false);
});
