# GD Test Lab

GD Test Lab is the repository-wide automated test platform for Group Director.
It combines static validation, automatically discovered behavior tests, a reusable
fake SillyTavern host, optional real-host contract checks, coverage, and machine
readable reports.

Current verified baseline (2026-08-12):

- 187 JavaScript source files pass static validation;
- 91 behavior tests are discovered, with 90 passing and one optional real-host
  contract skipped when `GD_TEST_ST_ROOT` is not configured;
- all 17 historical regression-contract IDs are represented;
- entry-point reachability is 135/143 production modules, while tests directly or
  transitively reach 34/143 production modules.

The reachability numbers are diagnostics, not success targets. A module can be
entry-reachable without being safe, and test reachability is not line coverage.

The workflow in `.github/workflows/gd-test.yml` runs the full platform on Windows
and Linux with Node 22 and 24 for every push and pull request, then uploads the
JSON report even when a test fails.

## Commands

```powershell
npm test
npm run test:static
npm run test:unit
npm run test:integration
npm run test:full
npm run test:coverage
```

Run a subset by file name or test name:

```powershell
node tools/gd-test/cli.mjs full --filter postspeech
```

Reproduce or vary property/fuzz cases:

```powershell
node tools/gd-test/cli.mjs quick --seed 20260726
```

Write a JSON report:

```powershell
node tools/gd-test/cli.mjs full --report test-results/full.json
```

Enable contract tests against a real SillyTavern checkout:

```powershell
node tools/gd-test/cli.mjs full `
  --st-root "E:\path\to\SillyTavern-release"
```

Alternatively set `GD_TEST_ST_ROOT`.

## Profiles

| Profile | Checks |
|---|---|
| `static` | JavaScript syntax, JSON parsing, manifest references, relative imports, merge markers, invalid replacement characters, isolated module-import smoke tests |
| `unit` | Pure modules and factory contracts |
| `integration` | Fake SillyTavern scenarios and optional real-host contracts |
| `quick` | Static + unit + regression |
| `full` | Every available check and test |

Tests are discovered automatically from `tests/**/*.test.mjs`; no central list
needs to be maintained. Tests that mutate singleton registries must clean up with
`t.after()`. Tests that manipulate browser-like globals should remain serial.

When the `quick` or `full` profile runs without a filter, GD Test Lab also checks
that all 17 confirmed historical bug IDs appear in executed test names. The
required IDs live in `gd-test.config.mjs`; deleting or accidentally renaming the
last scenario for any historical bug therefore fails the run even if every
remaining test passes. BUG-9 is intentionally absent because it was excluded from
the confirmed audit set.

The current historical contracts cover:

- async memory provider resolution and quoted path parsing (BUG-1, BUG-2);
- custom prompt overwrite and per-character auto-memory progress (BUG-3, BUG-4);
- deferred capability timing, completion bookkeeping, loader injection and
  capability removal/revision invalidation (BUG-5 through BUG-8);
- prompt cleanup and immutable script snapshots (BUG-10, BUG-11);
- ledger text safety, scope persistence, variable collision protection, trace
  normalization, localized world-book source labels, native timeout isolation,
  and listener deduplication (BUG-12 through BUG-18).

Static module smoke tests are also discovered automatically under `agents/`,
`systems/`, and `utils/`. Modules that transitively import SillyTavern browser
files are classified as host-dependent and left to integration tests.

The static summary reports module reachability from both the extension entry point
and the test suite. Test reachability is not line coverage, but it immediately
shows which production modules have never been loaded by any automated test.
Node's percentage coverage only describes modules loaded during that run; use it
together with test reachability instead of treating the percentage as whole-project
coverage.

## Round lifecycle coverage

The takeover flow is intentionally tested at three boundaries:

| Boundary | Primary modules/tests | Contract |
|---|---|---|
| Pure transition rules | `round-state.js`, `round-finalization.js`, `takeover-scheduler.js`; unit tests | No hidden state; mismatches, rerolls, finalization gates, and queue filtering are deterministic |
| Stateful coordination | `round-orchestrator.js`; `tests/integration/round-orchestrator.test.mjs` | One owner advances remaining speakers, retries failed plans, preserves completed speakers, and exposes finalization readiness |
| Host-facing execution | fake host plus `takeover-execution.test.mjs` | Ordered generation, request failure, nested wrappers, rerolls, and user stop behave correctly across asynchronous calls |

`index.js` should remain the event-and-side-effect adapter. New takeover rules
belong in the pure modules or orchestrator so they can be tested without importing
the SillyTavern browser runtime.

Import validators should be tested with malformed values at every nesting level,
including `null`, arrays where objects are expected, primitives, missing strings,
and invalid array elements. Validation failures must return structured results and
must not escape into UI event handlers as exceptions.

## UI safety coverage

DOM-heavy sections keep event wiring and element mutation in the section module,
while security-sensitive transformations live in small pure helpers imported by
that same production module. Current contracts cover:

- Custom Agent field allowlisting, trusted internal IDs, disabled import defaults,
  bounded numeric fields, and treating selector syntax as plain `data-id` text;
- Execution Trace stage rendering with encoded names, errors, and output keys;
- Dashboard profile summary display formatting kept separate from the raw editor
  value, so tags, motivation labels, and `<br>` markup are never persisted.

Prefer this boundary over copying UI logic into tests or building a broad fake DOM.
Use a browser-level contract only when the behavior depends on event propagation,
focus, layout, or a SillyTavern-owned widget.

## Writing behavior tests

Use `node:test` directly for pure modules:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

test('a stable behavior contract', () => {
    assert.equal(subject(), expected);
});
```

Use the scenario helper when a test needs SillyTavern state:

```js
import { scenario } from '../harness/scenario.mjs';

scenario('group lifecycle example', async ({ host, assert }) => {
    host.queueResponse({ type: 'resolve', value: 'model output' });
    const result = await host.generateRaw({ prompt: 'probe' });
    assert.equal(result, 'model output');
});
```

`FakeSillyTavernHost` supports:

- sequential asynchronous events compatible with SillyTavern;
- multiple simultaneous `generateRaw` requests;
- global stop and optional request-scoped cancellation;
- queued resolve/reject/pending model responses;
- chat, characters, groups and chat metadata;
- request, save and stop counters;
- condition waiting and deterministic cleanup.

For parsers, validators and state transformations, use the deterministic property
helper. It prints the seed, case number, and generated input on failure:

```js
import { property } from '../harness/property.mjs';

property('all generated values preserve an invariant', { cases: 500 },
    random => random.string({ maxLength: 40 }),
    value => assertInvariant(value),
);
```

## Test strategy

Every fixed bug should receive a regression test describing the desired behavior,
not the implementation. Large workflows should be decomposed into testable
coordinators with dependencies injected through factories. Real-host contract tests
protect the fake host from drifting away from SillyTavern semantics.

The platform automates execution and verification, but it cannot infer all business
requirements by itself. Coverage grows by converting each accepted behavior,
reported bug, and important lifecycle into a scenario. Unknown-bug discovery still
requires review, fuzzing, or exploratory testing.
