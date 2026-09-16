# GD Test Lab

GD Test Lab is the repository-wide automated test platform for Group Director.
It combines static validation, automatically discovered behavior tests, a reusable
fake SillyTavern host, optional real-host contract checks, coverage, and machine
readable reports.

Current verified baseline (2026-09-16):

- 296 JavaScript source files and 10 JSON files pass static validation;
- 422 behavior tests are discovered, with 421 passing and one optional real-host
  contract skipped when `GD_TEST_ST_ROOT` is not configured;
- all 17 historical regression-contract IDs are represented;
- entry-point reachability is 147/155 production modules, while tests directly or
  transitively reach 77/155 production modules;
- 78 production modules are currently not test-reachable. The full JSON report
  preserves their paths, while the console groups them by top-level area;
- the full loaded-module coverage snapshot is 92.58% lines, 77.15% branches, and
  89.72% functions. All eight built-in Agent modules are test-reachable; Custom
  Prompt validation reaches 98.95% lines / 93.75% branches, and Custom Prompts
  System reaches 98.33% lines / 86.36% branches / 100% functions. Memory
  System, Variable System, Memory Export, and Story Blueprint now reach 98.75%,
  96.57%, 99.32%, and 98.70% lines respectively, while Profile System reaches
  92.03% lines, 70.10% branches, and 87.18% functions. User Provider Loader now
  reaches 96.26% lines, 80.63% branches, and 84.00% functions; Script Executor
  System reaches 86.85% lines, 72.93% branches, and 88.89% functions;
  History, World Info, Asset Loader, NPC Export, and Summary Export reach 100% lines;
  `prompt-renderer.js`, `utils/custom-api.js`, and `systems/agent-runtime.js`
  independently reach 92.86%, 96.91%, and 91.98% lines.

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

## Test platform architecture

GD Test Lab separates four responsibilities:

```text
cli.mjs
  -> core/options + core/runner + core/test-runner
  -> core/project-index
  -> checks/**/*.check.mjs (automatic discovery)
  -> reporters/console + reporters/json
```

`project-index.mjs` builds shared project facts once. Each static checker owns one
rule domain and returns structured counts/issues without printing or writing.
`check-runner.mjs` validates contracts, applies deterministic `order -> id`
ordering, runs checker loading and execution in terminable Worker Threads,
isolates crashes/timeouts, and aggregates results. A timeout waits for
`worker.terminate()` before the next checker starts, so timed-out code cannot keep
running or retain event-loop handles. The compatibility
entry at `lib/checks.mjs` contains no concrete rules.

To add a static checker, create one `tools/gd-test/checks/*.check.mjs` file and its
tests. Do not add branches to the CLI or runner. The complete Checker v1 contract
is documented in `tools/gd-test/checks/README.md`.

Behavior tests remain native Node `node:test` files discovered from
`tests/**/*.test.js` and `tests/**/*.test.mjs`; checker plugins are not a
replacement test framework.
The normative Behavior Test v1 development standard is documented in
[`tests/README.md`](tests/README.md).

Tests are discovered automatically from `tests/**/*.test.js` and
`tests/**/*.test.mjs`; no central list needs to be maintained. Tests that mutate singleton registries must clean up with
`t.after()`. Test files run with concurrency 2; each file must therefore own its
fixtures and must not depend on execution order. Tests that manipulate browser-like
globals must restore them before completion.

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

Regression files are organized by business feature (`memory-provider`,
`capability-scope`, `execution-trace`, etc.), not collected into a growing
`historical-*` module. BUG IDs identify durable contracts but do not determine
file ownership.

Static module smoke tests are also discovered automatically under `agents/`,
`systems/`, and `utils/`. Modules that transitively import SillyTavern browser
files are classified as host-dependent and left to integration tests.

The static summary reports module reachability from both the extension entry point
and the test suite. Test reachability is not line coverage, but it immediately
shows which production modules have never been loaded by any automated test.
Node's percentage coverage only describes modules loaded during that run. Coverage
collection includes root production JavaScript plus `agents/`, `assets/`, `systems/`,
`ui/`, and `utils/`, but Node omits matching modules that were never loaded. GD Test
Lab therefore stores `moduleReachability.productionModules`, `testReachableModules`,
and `testUnreachableModules` in the static report. Use those lists together with the
percentage instead of treating loaded-module coverage as whole-project coverage.

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

Variable import transaction coverage belongs in
`tests/unit/variable-system-import.test.mjs`. Tests must use a deferred persistence
promise and cover both synchronous/asynchronous rejection. On failure they must
assert that imported definitions, values, and log entries are removed while
concurrent work is retained. This includes an unrelated variable update and an
append to the same array variable; the latter must restore the pre-import sequence
and replay only the concurrent array delta.

Profile persistence coverage belongs in `tests/unit/profile-system-data.test.mjs`.
Both direct saves and active-to-archive moves must await chat persistence and undo
only the mutation that is still present when persistence rejects. Deferred-save
tests cover restoration of prior active/archive values plus concurrent changes to
the same avatar and unrelated profiles. Generation staleness remains covered by
`tests/unit/similar-agent-concurrency.test.mjs`.

User Provider/Capability lifecycle coverage belongs in
`tests/unit/user-provider-loader.test.mjs`. Modules must be exercised through real
dynamic import semantics, including asynchronous `register()` rejection, partial
registry mutation, and Blob URL cleanup. Deferred-save cases assert operation-local
rollback for import, delete, restored-ID persistence, and capability toggles while
preserving unrelated concurrent edits. Restore tests also own actual-ID refresh,
same-owner definition compensation, hot-reload ghost cleanup, and cross-owner
collision protection. `tests/unit/capability-registry.test.mjs` owns the registry's
same-owner refresh and owner-checked unregister contract; the UI contract verifies
that rejected persistence is reported and controls are released in `finally`.
Timeout coverage uses a short injected registration deadline and must exercise
stalled module evaluation, never-settling async `register()`, partial rollback,
late Provider/Capability rejection, continued restore of later assets, and Blob
URL cleanup. Production uses the loader's 10-second default.

Custom Prompt coverage is split across `custom-prompt-validation.test.mjs`,
`custom-prompts-system.test.mjs`, `custom-prompts-transaction.test.mjs`, and the
UI safety contract. The shared validator owns complete entry/export shapes and
fresh config-profile IDs. Deferred-save tests require rejected mutations to
restore only their own fields while preserving concurrent edits; lifecycle tests
own cross-Provider collision protection, hot-reload ghost cleanup, master/item
toggles, import identity, and Blob/anchor cleanup. UI mutations must await the
system Promise before showing success.

Config Profile JSON, ZIP, and built-in preset manifests share one validation
boundary. Applying a profile prepares settings on a detached copy, imports
variables only after preparation succeeds, and rolls live settings/variables back
when the transaction fails. JSON imports discard endpoint configuration and
name-only Provider/Capability stubs; ZIP imports may restore matching script
sources. Tests must also cover concurrent unrelated setting edits while variable
persistence is pending, concurrency-safe compensation after a later settings
failure, and list rollback when save/delete/import/preset persistence throws.
JSON/ZIP export tests own credential stripping, executable-source isolation, asset
packaging, variables, and download cleanup. UI handlers report apply/save/delete
failures without running success refreshes. The apply-handler contract also keeps
the Prompt merge-mode declaration outside its `try` block because the
post-refresh success message reads that mode after the block completes.

Script Executor tests follow the same boundary rule. The pure validator owns the
version-1 file and entry contract, while system tests cover candidate validation,
single-save batch import, conflict overwrite/skip/cancel behavior, persistence
rollback, execution ordering, trigger filtering, error isolation, and per-instance
turn state. The UI contract verifies that import/export handlers delegate to the
system instead of performing incremental `add`/`remove` mutations. Config Profile
imports reuse the validator and replace external executor IDs before storage.
CRUD tests inject both synchronous throws and asynchronous save rejections,
verify operation-local rollback and concurrent unrelated edits, require
overlapping CRUD saves to serialize, and require Promises to settle only after
the callback settles. The UI contract requires
every CRUD call to be awaited before refresh. SillyTavern's current debounced
settings save does not expose its network result, so these tests verify the
observable callback contract, not a guaranteed server commit.
Runtime tests use short injected timeouts and deferred Promises to verify that
timed-out scripts cannot mutate nested shared state, retained return values and
decision copies do not alias committed state, and an old message execution stops
launching scripts after a turn reset. Error isolation still lets subsequent
scripts run within the same live turn.

Custom Agent coverage uses the same layered contract: the validator owns field,
Schema, duplicate-ID/provider, and disabled-import rules; the system suite owns
transactional CRUD/import, Provider lifecycle, request deduplication, stale chat
and config rejection, and result/checkpoint rollback. The pure auto coordinator
tests first-enable, normal interval, ordering, and deletion-reset decisions. UI
tests should verify delegation only—the section must not mutate `customAgents`,
`_caData`, or `_autoCAG_*` directly.

Critique coverage follows five independent boundaries: parser tests own balanced
JSON extraction and noisy model output; validation tests own nested critique and
export contracts; repository tests own activation, `basedOn` revert, pruning, and
persistence rollback; execution tests own the shared lock and quiet-prompt cleanup;
and the auto coordinator tests first-enable, interval, deletion reset, and
checkpoint rollback. System tests cover prompt reuse, raw-text fallback, stale-chat
rejection, and edited-result persistence. The UI contract forbids direct history
mutation, JSON parsing, and chat persistence from the section module.

## Asynchronous result consistency coverage

`tests/unit/similar-agent-concurrency.test.mjs` owns the shared concurrency contract
for Summary, Memory, NPC, Profile, and Story Blueprint. Deferred promises create
deterministic interleavings for chat switches, in-place message appends, manual
edits, reverts, compression, and stale LLM responses. A valid stale rejection must
use `StaleExecutionError` and leave the newer state untouched.

External side effects have a separate contract. NPC character-card tests verify
that staleness is checked before the create POST, successful creates reconcile by
stable `importId` even when a same-timestamp sibling exists and the target is
renamed, and tracking-save failure surfaces `NpcImportTrackingError` with the
created `avatarName`. The in-memory receipt remains marked imported so a later
successful chat save can flush it, while the UI warns against retrying the create.

## UI safety coverage

DOM-heavy sections keep event wiring and element mutation in the section module,
while security-sensitive transformations live in small pure helpers imported by
that same production module. Current contracts cover:

- Custom Agent UI numeric bounds and treating selector syntax as plain `data-id`
  text; field allowlisting, trusted IDs, and disabled imports live in the shared
  system validator tests;
- Execution Trace stage rendering with encoded names, errors, and output keys;
- Dashboard profile summary display formatting kept separate from the raw editor
  value, so tags, motivation labels, and `<br>` markup are never persisted;
- Profile management HTML-encodes avatar attributes and locates edit panels by DOM
  ancestry rather than interpolating imported avatar strings into element IDs.
  Loader/card failure paths must catch rejected promises, report an error, and
  restore disabled buttons in `finally`.

Prefer this boundary over copying UI logic into tests or building a broad fake DOM.
Use a browser-level contract only when the behavior depends on event propagation,
focus, layout, or a SillyTavern-owned widget.

## Writing behavior tests

This section is a quick-start summary. File ownership, naming, isolation,
concurrency, regression, and review requirements are normative in
[`tests/README.md`](tests/README.md).

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
