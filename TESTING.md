# GD Test Lab

Muyu 档案生成 Prompt 批次（2026-09-25）：`profileGeneratorPrompt` 接入选择性读取、预览及逐份确认；保留角色字段和已注册 Provider 占位符、空串恢复默认、生成中禁写及经典编辑器聚焦草稿。全量 **1099 项，1098 通过、1 跳过、0 失败**；静态检查与历史 BUG 契约 17/17 通过。真实浏览器和付费模型尚未验收。

Muyu 点评输出示例批次（2026-09-25）：`critiqueSchema` 接入选择性读取、结构预览及逐份确认；非空新草稿须为有界 JSON 示例，空串恢复默认，保留经典界面未聚焦同步与聚焦草稿。全量 **1096 项，1095 通过、1 跳过、0 失败**；静态检查及历史 BUG 契约 17/17 通过。真实浏览器和付费模型尚未验收。

Muyu Prompt 配置批次（2026-09-25）：`summaryPrompt` 与 `critiquePrompt` 进入选择性读取、预览和逐份确认流程；空值回退内置 Prompt，生成中禁止写入，重生成旧记录仍优先使用记录内 Prompt。专项测试覆盖授权、Schema 不变、长文本边界、旧草稿失效和经典编辑器焦点保护。全量 **1093 项，1092 通过、1 跳过、0 失败**；静态检查及历史 BUG 契约 17/17 通过。真实浏览器和付费模型尚未验收。

Memory-limit action (2026-09-25): `muyu-memory-limit.test.mjs` covers a single-field, current-chat-bound preview; anonymized per-character counts; zero raw-memory exposure; stale memory/chat rejection; one approved global save followed by chat pruning; and partial/unknown outcomes for save failure, a new generation, concurrent edits, or chat switching. `muyu-settings.test.mjs` retains the 40-field inventory and legacy four-field draft compatibility. Full suite: **1081 tests, 1080 passed, 1 skipped, 0 failed**; static checks and historical BUG contracts 17/17 passed. Real-browser and paid-model acceptance remain manual.

Memory-setting closure (2026-09-25): `muyu-settings.test.mjs` now checks `memoryKeepRecent` contract, 1–100 tool range, dependency freshness, exact diff, sibling preservation, and one-time application. The legacy four-field memory draft remains unchanged. `memoryTokenBudget` is explicitly inactive in the classic UI and is not offered as an agent-write field; `memoryMaxEntries` remains pending a chat-data pruning action. Full suite: **1074 tests, 1073 passed, 1 skipped, 0 failed**; static checks and historical BUG contracts 17/17 passed. No live-browser or paid-model acceptance was performed for this change.

Configuration domains round 1 (2026-09-25): `muyu-settings.test.mjs` and unified controller cases cover the explicit default-key inventory, selective reads, separate config permission, default-deny tool policy, nested sibling preservation, semantic conflicts, runtime guards, one-shot approval, async save failures, long prompts/receipts, inert history import, and invalid replacement candidates. Full suite: **1042 tests, 1041 passed, 1 skipped, 0 failed**; static checks passed; historical BUG contracts 17/17. Report: `.bug-hunter/muyu-settings-round1-tests.json`. No paid-model or real-browser acceptance was performed. The registered 13 leaf fields and remaining scope are documented in [the configuration contract](muyu/config/README.md).

Provider 扩展基础（2026-09-25）：用户脚本加载器的私有源码摘要在恢复后保持一致；运行实例替换时拒收迟到结果；可选上下文声明报告缺失并提供有界投影；Provider 执行 v2 的长结果在同一 Run 分页读取且不重复执行，Broker 按原版本授权检查每页。全量 1024 项，1023 通过、1 跳过、0 失败；随后补充的 Broker 分页授权用例另行专项通过，其他代码未变。历史 BUG 合同 17/17。

Registered Provider execution (2026-09-25): `muyu-provider-execution.test.mjs` verifies metadata discovery without render, exact script/version/task/chat approval, denial, replacement, async stale results, legacy render context, content/data projection, legacy-mode isolation, and history withholding/restoration. Panel tests verify the code-execution disclosure and absence of persistent execution approval. Full suite: 1020 tests, 1019 passed, 1 skipped, 0 failed; historical BUG contracts 17/17. This synthetic suite does not establish that arbitrary user JavaScript is sandboxed or side-effect-free.

Provider story-source stage (2026-09-24): `muyu-story-sources.test.mjs` covers raw variable values, chat-local global scope, missing/default separation, blueprint hierarchy and unpruned signals, no mutation, opaque identities, malformed/oversized data, pagination/Unicode, stale snapshots and budgets. Unified controller cases additionally verify zero pre-grant reads, independent source grants, denial, global-session rejection and history expiry. Targeted: 317/317. Full: 1013 tests, 1012 passed, 1 skipped, 0 failed; historical BUG contracts 17/17. No paid-model or browser acceptance is implied.

Unified Muyu assistant (2026-09-24): `muyu-unified.test.mjs` covers mixed-tool tasks, lazy draft binding, source-level denials across alternate readers, task-grant expiry and history withholding/restoration, explicit history omission, global/chat scope, reconnect and legacy read-only sessions. Panel tests cover Chinese/English unified entry points without pre-send permission or task selectors. Targeted: 309/309. Full: 1005 tests, 1004 passed, 1 skipped, 0 failed; 17/17 historical BUG contracts. No new paid-model or browser acceptance is implied.

Muyu config application (2026-09-24): `muyu-config-apply.test.mjs` and controller/panel
integration cover explicit one-shot approval, immutable drafts, final baseline checks,
save exceptions/unconfirmed receipts, concurrent edits and reconnect drain. Production
ST persistence is conservatively unconfirmed; see `muyu/actions/README.md`.

Muyu on-demand permissions (2026-09-24): `muyu-permissions.test.mjs` plus controller/UI
coverage verify source/task/chat isolation, rollback, zero unauthorized reads, denial,
history/summary guards, stale requests and the shared six-handoff ceiling. See
`muyu/permissions/README.md`. Deterministic tests do not imply browser or live-model acceptance.

Muyu clarification stage (2026-09-24): added bounded request/store/runtime tests,
same-task continuation and scope invalidation checks, three-question cap, draft/remount
UI coverage, and pending-drain/late-result cases. See `muyu/interactions/README.md`.
The separate synthetic DeepSeek harness exercises question/draft/answer/clear-query
flows; its model-output review is distinct from deterministic and browser acceptance.

GD Test Lab is the repository-wide automated test platform for Group Director.
It combines static validation, automatically discovered behavior tests, a reusable
fake SillyTavern host, optional real-host contract checks, coverage, and machine
readable reports.

Latest navigation/feature-migration check: 44/44 targeted tests pass, including
complete route coverage across primary and collapsed entries and a CSS contract for
the overview disclosure button's bounded content width, live profile control identity,
classic order restoration, dynamic results, language updates and listener cleanup.
Director/memory/summary coverage also verifies mode/enable ancestry, result-before-action
ordering, More disclosures and template grouping with summary status outside switched views.
The compact-page checks cover simultaneous basic/settings visibility, no view
buttons, on-demand editor expansion, connection visibility and classic restoration.
All-page disclosures additionally validate 12 curated ranges against the real
template, exact restoration, library navigation, language refresh, core-editor/error
visibility and non-mutating failure on an invalid mapping.
The profile tree fixture does not simulate CSS layout. Browser visual and keyboard
acceptance remains manual.

Control board checks add six quick-action behavior tests for disabled/no-chat/round
guards, shared locks and panel rebuild reuse, partial and total failure, chat-switch
batch termination, subscriber cleanup and mode/limit validation. An assembly contract
checks route IDs, shared action delegation, cleanup and board return-scroll wiring.
These do not substitute for real-host DOM, keyboard or layout acceptance.

The b69f6c8 follow-up adds seven state regressions: actual round-handler transitions
refresh mounted board controls; both speaker inputs restore rejected values; the
single debug control retains its listener and classic position; blueprint detail
status clears after successful, failed and blocked continuation via the shared adapter.
Six follow-up regressions preserve JSON and prompt drafts when an old continuation
settles after a chat switch, panel rebuild, or both (success and rejection paths).
The fixture also transitions continuePending from true to false while rebuilding:
the current panel must clear stale running text without a full editor refresh.

Current verified baseline (2026-09-19):

- 330 JavaScript source files and 11 JSON files pass static validation;
- 693 behavior tests are discovered, with 692 passing and one optional real-host
  contract skipped when `GD_TEST_ST_ROOT` is not configured;
- all 17 historical regression-contract IDs are represented;
- entry-point reachability is 157/165 production modules, while tests directly or
  transitively reach 86/165 production modules;
- 79 production modules are currently not test-reachable. The full JSON report
  preserves their paths, while the console groups them by top-level area;
- the pre-navigation loaded-module coverage snapshot (not remeasured for the
  navigation preview) is 94.95% lines, approximately 80.0%
  branches (the seeded suite can vary by a few hundredths), and
  92.41% functions. All eight built-in Agent modules are test-reachable; Custom
  Prompt validation reaches 98.95% lines / 93.75% branches, and Custom Prompts
  System reaches 98.36% lines / 88.50% branches / 100% functions. Memory
  System, Variable System, Memory Export, and Story Blueprint now reach 98.75%,
  96.53%, 99.32%, and 98.30% lines respectively, while Profile System reaches
  92.03% lines, 70.10% branches, and 87.18% functions. User Provider Loader now
  reaches 96.26% lines, 80.12% branches, and 84.00% functions; Script Executor
  System reaches 90.60% lines, 77.36% branches, and 93.62% functions;
  History, World Info, Asset Loader, and Summary Export reach 100% lines;
  NPC Export reaches 96.60% lines with its new transaction branches;
  NPC Library reaches 98.15% lines; Profile Library and Story Blueprint Library
  reach 96.96% and 98.66% lines respectively; Chat Summary System reaches 92.89%
  lines, 65.15% branches, and 93.33% functions;
  NPC System reaches 95.73% lines, 71.43% branches, and 70.00% functions;
  Group ZIP Import/Export reaches 89.84% lines, 82.68% branches, and 85.71%
  functions; PostSpeech Decision Store reaches 98.33% lines and 92.37% branches;
  PostSpeech Executor reaches 100% lines/functions and 96.55% branches;
  `prompt-renderer.js`, `utils/custom-api.js`, and `systems/agent-runtime.js`
  independently reach 92.86%, 96.91%, and 91.98% lines.

The reachability numbers are diagnostics, not success targets. A module can be
entry-reachable without being safe, and test reachability is not line coverage.

The workflow in `.github/workflows/gd-test.yml` runs the full platform on Windows
and Linux with Node 22 and 24 for every push and pull request, then uploads the
JSON report even when a test fails.

## Commands

Navigation preview verification adds six model tests and three assembly contracts:
classic defaults, per-area history, preference failure handling, exclusion of
private data, complete legacy-card routing, presentation-only switching and
navigation cleanup during settings reload. These tests do not verify DOM layout,
focus behavior, or browser interactions. Manual checks at 320/400/600/800px,
keyboard flows, and real-host switching remain pending; see `UI-REWORK.md`.

Install the development-only JavaScript parser before running the test platform:

```powershell
npm ci
```

Acorn is used for static import analysis (including string-literal dynamic imports).
It is not a runtime dependency of the SillyTavern extension.

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
gate reads structured test events and only accepts passing, non-skipped, non-TODO
test cases; console output and suite names do not satisfy a contract. A filter
matching no test cases fails, including when Node reports only a passing file wrapper.
The required IDs live in `gd-test.config.mjs`; deleting or accidentally renaming the
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
and replay only the concurrent array delta. A separate save-success/chat-switch
test must capture the old chat's persisted snapshot and assert it still matches
memory when import or explicit compensation reports stale; the new chat must stay
untouched.

Profile persistence coverage belongs in `tests/unit/profile-system-data.test.mjs`.
Both direct saves and active-to-archive moves must await chat persistence and undo
only the mutation that is still present when persistence rejects. Deferred-save
tests cover restoration of prior active/archive values plus concurrent changes to
the same avatar and unrelated profiles. Generation staleness remains covered by
`tests/unit/similar-agent-concurrency.test.mjs`.

Chat Summary persistence coverage belongs in
`tests/unit/chat-summary-system.test.mjs`, with UI delegation and rejected-save
feedback in `tests/unit/chat-summary-ui.test.mjs`. Generation, regeneration,
content edits, revert, reset, pruning, and clearing must serialize system-owned
writes, remain bound to their original chat metadata, and compensate only their
own entries or fields. Deferred-save tests cover concurrent edits/additions,
restored ordering, queued target identity, incomplete rollback reporting, and a
successful old-chat save followed by a chat switch. Public reads must be detached
snapshots; UI tests prohibit direct summary array mutation and direct chat
persistence. A deferred prune must lock stale scan-number edits while persistence
is pending and rebuild the scan from current memory before unlocking on success,
rollback, or `persistenceUnknown`; an unknown readback after a successful write
must never leave old indexes editable. `tests/unit/chat-metadata-save-confirmation.test.mjs`
covers group and character readback, swallowed host failures, concurrent state,
and unavailable verification. A definite stored-state mismatch must enter normal
transaction compensation; `persistenceUnknown` must reject while retaining the
possibly persisted in-memory Summary state.

NPC Library persistence coverage belongs in `tests/unit/npc-library-system.test.mjs`,
with UI feedback and malformed legacy rendering in `tests/unit/npc-library-ui.test.mjs`.
Deferred-save cases must cover save, delete, and file import rejection while a
different library entry changes; failed downloads must release both temporary DOM
and Blob URL resources. Application through NPC Export is tested separately.
The production adapter calls the host's direct settings save and requires its
`SETTINGS_UPDATED` success event; a swallowed save failure without that event
must reject and remove the temporary listener. The dashboard delete handler
must await rejection, show an error, and refresh after rollback. The host event
has no request ID, so concurrent host saves are not strictly attributable.

Profile and Story Blueprint Library persistence coverage belongs in
`tests/unit/profile-library-system.test.mjs` and
`tests/unit/story-blueprint-library-system.test.mjs`, with awaited UI feedback in
`tests/unit/library-ui-persistence.test.mjs`. Save, delete, import, and auto-load
setting mutations must await confirmed settings persistence, serialize overlapping
writes, and compensate only their own entry or fields. Deferred-save tests retain
concurrent neighbors and newer field values. Save-current tests also switch chats
behind a blocked earlier write and require the queued entry to retain the source
name and detached payload captured at invocation. Story Blueprint library application
uses one awaited chat save through `applyImportTextAndSave`; a failed save performs
three-way rollback that removes imported state while retaining concurrent object
and array edits, followed by a compensating save; failed compensation is reported
as incomplete rather than atomic success. Production imports confirm the original
chat header after the host save; unavailable readback preserves the imported memory
and reports `persistenceUnknown` without compensation. Library download tests require temporary anchors and Blob URLs to
be released even when the synthetic click throws.

NPC Export import application coverage belongs in `tests/unit/npc-export-system.test.mjs`.
Both direct import and NPC Library application share this boundary. Tests must cover
synchronous/asynchronous chat-save rejection, operation-local rollback after
unrelated and same-NPC edits, prompt-only import, observable settings-save failure
and failed compensation, and a chat switch after successful persistence. Newly
imported NPCs edited concurrently are preserved with an explicit incomplete
rollback error. NPC Library UI must report application rejection without success
feedback; the production debounced settings callback cannot prove later disk writes.

NPC System mutation coverage belongs in `tests/unit/npc-system.test.mjs`, with
generation staleness and irreversible character-card import in
`tests/unit/similar-agent-concurrency.test.mjs`, and edit/delete feedback in
`tests/unit/npc-ui.test.mjs`. Deferred-save tests must cover synchronous and
asynchronous rejection, unrelated and same-NPC concurrent edits (including a
later same-value write), delete ordering after list replacement, generated
additions edited while saving, and chat switches after successful persistence.
Generation reports only NPCs actually added; UI feedback must wait for save.
Remote character-card creation remains a separate follow-up boundary.

Group ZIP import/export coverage belongs in `tests/unit/export-import-system.test.mjs`,
with rejected UI actions in `tests/contract/export-import-ui.test.mjs`. Import tests
must prove malformed manifests, unsafe or duplicate paths, missing member cards,
and corrupt world books make no remote requests. Host responses with HTTP 200 but
no character filename count as failures. A failed required card must not create a
group, while any attempted remote write must yield an incomplete/inspection
warning rather than a definite no-resource claim. Tests
also verify avatar remapping, avoidance of known world-book name collisions,
collision-safe mappings for valid filenames whose basenames resemble another card,
cross-call world-book reservations against both earlier imports and a replaced live
host name list, partial export manifest membership, original-chat export snapshots,
and cleanup of temporary download nodes and Blob URLs on failure. HTTP-success responses
with empty card bodies or invalid world-book payloads must not enter an export
archive that the importer would reject. Remote uploads are not a
rollback transaction; tests must not pretend partial success is atomic.

PostSpeech Executor coverage belongs in `tests/unit/executor.test.mjs`, while the
historical round-end and stale-Capability contracts remain under regression tests.
The unit suite owns malformed-intent filtering, exact/alias/fallback resolution,
disabled capabilities, numeric schema coercion and rejection, immutable nested
params and defaults, immediate and
round-end scheduling, blocking/non-blocking receipts, callback isolation, live
Capability resolution, and deferred-input validation. Unknown timing values must
log and fall back to immediate execution rather than silently becoming round-end
work. Both synchronous and asynchronous `onExecuted` failures are isolated, and
the callback contract applies in blocking mode as well.

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
Configuration tests also inject asynchronous settings-save rejection across CRUD
and import, verify serialized saves and operation-local rollback under concurrent
edits, and require the UI to await mutations. Execution tests interleave failed
chat saves with newer result or counter writes (including the same counter value)
and switch chat/configuration during a pending save. These tests verify the
observable save-callback contract; SillyTavern's debounced settings save does not
expose a guaranteed network commit result.

Critique coverage follows five independent boundaries: parser tests own balanced
JSON extraction and noisy model output; validation tests own nested critique and
export contracts; repository tests own activation, `basedOn` revert, pruning, and
persistence rollback; execution tests own the shared lock and quiet-prompt cleanup;
and the auto coordinator tests first-enable, interval, deletion reset, and
checkpoint rollback. System tests cover prompt reuse, raw-text fallback, stale-chat
rejection, and edited-result persistence. The UI contract forbids direct history
mutation, JSON parsing, and chat persistence from the section module.

Deferred-save Critique tests also interleave failed add/update/revert/reset/prune
with newer edits, including different fields on the same record. Auto-coordinator
tests cover a newer checkpoint surviving an older failed save and chat switches
during `beforeExecute` or counter save. System tests require stale rejection when
the chat switches during generation or regeneration result save; an already
successful old-chat save is not rolled back.

Imported Critique tests use deferred saves to interleave failed add, update,
and delete with newer mutations, including same-value field writes and changed
neighbor positions. They check save-time chat switches and old-chat-only
compensation. Export tests verify Blob URL and temporary anchor cleanup on
success and thrown download steps; UI tests require failed import/export to
show only an error notification.

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

## Muyu Agent kernel addition (2026-09-24)

The Muyu foundation, runtime, application, workspace and classic UI have 151 focused tests in
`tests/unit/muyu-foundation.test.mjs`, `tests/unit/muyu-execution.test.mjs`,
`tests/unit/muyu-application.test.mjs`, `tests/unit/muyu-model.test.mjs`,
`tests/unit/muyu-memory.test.mjs`, `tests/unit/muyu-config-draft.test.mjs`,
`tests/unit/muyu-controller.test.mjs`, `tests/unit/muyu-panel.test.mjs`, and
`tests/contract/muyu-boundaries.test.mjs`. They use scripted model events and an
injected clock; no API keys, network, ST session, or UI are required. Coverage
includes cancellation, bounded waits, call/result pairing, deduplication,
permissions, argument/output checks, budgets, and the core import boundary.
Application tests cover physical drain gating, queue limits, chat ownership,
subscription remounting, task continuation, artifact revisions and capacity.
The `muyu` directory is now included in module smoke checks and coverage selection.
This does not establish full-suite coverage or real-model/host compatibility.
Implementation limits are documented in [muyu/README.md](muyu/README.md).

Classic UI checks cover mount/dispose subscriptions, input preservation, consent reset,
text-only rendering, connection credential clearing and one-click/keyboard submission.
Controller tests cover target identity, physical drain, chat changes, global drafts,
trusted publication and stale validation. The DOM double does not validate layout.
Browser acceptance is pending (no browser was available on 2026-09-24): test
320/400/600/800px containers, keyboard focus, Chinese/English, panel rebuilding,
chat-switch cancellation and a real DeepSeek request from the ST origin (including
CORS failure reporting). Do not infer browser success from Node harness results.

Manual follow-up (2026-09-24): after syncing both local release extension directories,
the user reported successful operation with no issues. This confirms a basic real-host
smoke run, not exhaustive completion of the browser checklist above. Automated baseline:
101 Muyu tests passed; full suite 794 tests, 793 passed, 1 skipped, 0 failed; static PASS.

Floating UI follow-up: `tests/unit/floating-ui.test.mjs` verifies generic module registration,
badge aggregation, unregistration, single-window mounting, focus return, language remount,
drag handling and viewport constraints. Muyu panel tests also cover standalone subscription,
input recovery and authorization reset on reopening. These tests do not establish real-browser
layout, native resize, touch input or host z-index compatibility; the earlier user smoke run
predates the floating window.

Floating implementation validation: full suite 801 tests, 800 passed, 1 skipped,
0 failed; static PASS. The six generic floating-shell tests are separate from
the 102 Muyu-specific tests. No browser geometry verification was performed.

Chat-first UI iteration adds bubble toggle, hidden settings/return navigation, unsent-key
clearing, input preservation, pre-send authorization, task selector and message bubble tests.
The current generic floating tests number seven; the Muyu-specific tests number 105.
Ctrl+Enter opens the confirmation card only, and no model call occurs before explicit consent.
Validation: full suite 805 tests, 804 passed, 1 skipped, 0 failed; static PASS.
Visual layout and real-host interaction for this iteration still require manual acceptance.

Process observability adds `tests/unit/muyu-process.test.mjs` for safe event projection,
per-run/global bounds, replay rejection, execution versus reuse/denial, observer isolation,
logical cancellation versus physical drain, model/startup failures and exclusion from model history.
Panel tests cover persistent details nodes, expansion/list scroll and current-view cleanup.
The runtime event contract now includes model started/completed/failed and tool started/reused;
cancellation tests use attempt identity instead of hard-coded global event sequence numbers.
Process iteration result: 111 Muyu tests passed; full suite 811 tests, 810 passed,
1 skipped, 0 failed; static PASS (370 sources, 11 JSON, 92 module smoke checks).
No real-model requests or browser acceptance were performed for this iteration.

Director/context/Markdown iteration adds `muyu-director.test.mjs` and `muyu-markdown.test.mjs`,
plus controller/panel scenarios for director scope, permission wording, anonymous publication
and denial of cross-task state tools. Director tests reject changed evidence/targets and avoid
reading raw reasons. Markdown tests verify formatting and that HTML, images and unsafe links
remain inert. These are deterministic tests, not real-model quality or browser layout acceptance.

Director/context/Markdown validation: 120 Muyu-specific tests; full suite 820 tests,
819 passed, 1 skipped, 0 failed; all 17 regression contracts passed; static PASS
(378 sources, 11 JSON, 98 module smoke checks). No live-model request or browser
acceptance was performed for this iteration. Markdown is a bounded subset, not
a complete CommonMark implementation; raw HTML and remote images remain inert.

Provider/permission/credential iteration adds `muyu-provider-access.test.mjs` plus
controller, panel and process tests. Coverage includes reusable grants, chat isolation,
revocation during a pending run, reset model history, pure provider projections, directory
identity/revision checks, paging and byte budgets, disabled/replaced sources, optional
credential persistence, exact endpoint reuse, save failures and key-free snapshots/DOM.
`config-profile-export.test.mjs` verifies stripping the remembered Muyu key from snapshots
and exported profiles. Browser and live-model acceptance remain pending.

Provider iteration validation: 135 Muyu-specific tests; full suite 836 tests,
835 passed, 1 skipped, 0 failed; 17/17 historical BUG contracts passed; static PASS
(384 source files, 11 JSON, 103 module smoke checks). The final chat-only process
note adjustment was additionally checked by rerunning panel/process tests.

Extended context iteration adds six scenarios covering independent chat-scoped extended
grants, source-specific policy enforcement, older message range access, card participant
restriction and identity changes, ledger projections and staleness, and the GUI opt-in.
No arbitrary card extensions, message extras, alternate swipes or other chats are read.

Extended-context validation: 141 Muyu-specific tests; full suite 842 tests,
841 passed, 1 skipped, 0 failed; 17/17 historical BUG contracts passed; static PASS
(386 source files, 11 JSON, 105 module smoke checks). No live-model or browser
acceptance was performed for this extension; both local release copies are synced.

Workbench budget phase adds `muyu-budget.test.mjs` plus model/controller/panel cases:
closed configuration bounds, save rollback, per-run snapshots, answer-only finalization,
skipped tool-result pairing, refusal of further tools, timeout/cancellation without extra
requests, per-run Provider quota, actual/unknown token usage, private thinking replay,
and budget form persistence across progress updates. Conversation persistence and
resumable checkpoints are not implemented by this phase.

Budget-phase validation: 151 Muyu-specific tests; full suite 852 tests, 851 passed,
1 skipped, 0 failed; 17/17 historical BUG contracts passed; static PASS (390 sources,
11 JSON, 108 module smoke checks). No live-model request or browser acceptance was
performed for this phase; finalization protocol was exercised using synthetic responses.

Session-repository phase 2A adds `muyu-history.test.mjs` and `muyu-history-idb.test.mjs`,
plus controller/panel scenarios. Coverage includes opt-in persistence, lazy body reads,
failed saves and retries, CAS conflicts, atomic metadata/body rollback, verified account
namespaces, overlapping reads, bounded complete-turn replay, reconnect/revocation gates,
inert reload, draft isolation and idle runtime-cache reclamation. The IDB adapter is tested
with a narrow asynchronous transaction double, not a real browser implementation.

Phase 2A validation: full suite 871 tests, 870 passed, 1 skipped, 0 failed;
17/17 historical BUG contracts and static checks passed. A separate Muyu-only run
passed 169 tests. The final profile-export assertion excluding the history privacy
setting was checked separately (6/6 profile-export tests). No live API request or
browser acceptance was performed; native IDB quota, account switching, multiple tabs
and 320/400/600/800px layout remain manual acceptance items. Both local release copies
receive the same implementation and documentation. See [session contract](muyu/sessions/README.md).

History-workbench phase 2B adds title/scope/task/archive filters, confirmed metadata
management, read-only foreign-chat and imported records, explicit import previews,
JSON/Markdown exports, view-local scroll restoration and responsive sidebar tests.
Storage coverage includes v1-to-v2 migration, atomic deletion, stale-update rejection,
concurrent answers during metadata saves, autosave-off behavior and late reads after
deletion. Controller cases verify physical task drain before deletion and isolation
from another session's running task.

Phase 2B validation: full suite 895 tests, 894 passed, 1 skipped, 0 failed;
193/193 Muyu-specific tests, 17/17 historical BUG contracts and static checks passed.
No live-model requests or real-browser acceptance were performed. DOM/ResizeObserver
and IndexedDB doubles do not replace native quota, multi-tab, account-switching or
320/400/600/800px visual acceptance. Imports remain permanently read-only in this phase;
archive does not reclaim capacity, and confirmed deletion has no trash/undo.

Sidebar-first navigation follow-up: creation/search and collapsed filters live in the
sidebar, import is in its footer, and exports are in conversation menus (not settings).
Two added panel cases cover entry placement, narrow-screen close after selection/create,
row-specific export and stale-selection rejection. Full suite: 897 tests, 896 passed,
1 skipped, 0 failed; 17/17 historical BUG contracts passed. After the final scope-label
change, Muyu-specific tests passed 195/195. Real-browser layout remains manual acceptance.

Context-workbench phase 3 adds `muyu-context.test.mjs` plus model/controller/panel cases.
Coverage includes closed configuration and save rollback, mixed-language estimation,
complete-turn trimming, preflight limits with private reasoning/tool overhead, bounded
rolling summaries, no-tool summary protocol, cancellation/timeout/physical drain,
same-run budget accounting, one-send omission, original transcript preservation,
permission/chat/delete isolation, opt-in summary persistence and read-only JSON import.
V1/v2 records normalize to v3; the index excludes summary text. The core dependency
contract remains unchanged: context capabilities are injected by composition.

Validation: full suite 916 tests, 915 passed, 1 skipped, 0 failed; static checks and
17/17 historical BUG contracts passed. Muyu-specific coverage comprises 214 passing
tests. No live API calls, tokenizer calibration, browser layout acceptance or native
IndexedDB multi-tab/quota acceptance were performed. Summary quality is not established
by deterministic fixtures; see [context contract](muyu/context/README.md).

Behavior-preference phase adds `muyu-instructions.test.mjs` plus controller/model/panel
and config-profile cases. Covers opt-in composition, closed bounds and oversized drafts,
confirmed save rollback/concurrent editing, send-time snapshots, summary isolation,
budget enforcement, denied tool access despite malicious preferences, single system
message insertion with unchanged thinking indices, finalization replay, view remounts,
and profile import/export/apply exclusion. Core dependency rules remain unchanged.

Final validation: full suite 927 tests, 926 passed, 1 skipped, 0 failed; static checks
and 17/17 historical BUG contracts passed. Muyu-specific suite: 224 tests.
Separate DeepSeek harness: four same-question heuristic checks passed (6 requests),
then a focused constraint/unknown-state check passed after two base-rule clarifications
(2 requests). Human review found wording issues in the initial comparison; the final
wording was not rerun across all four live cases. Total reported live usage: 9522 tokens.
These are synthetic Node tests, not browser/ST acceptance or general quality guarantees.
See [instruction contract](muyu/instructions/README.md); harness stays outside the plugin.

Operation receipts add `muyu-receipts.test.mjs` and controller/context/panel cases:
closed bounded facts, inert v4 persistence/import/export, deduplication, storage failure
and data-only retry, origin-session ownership across selection changes, concurrent edits,
explicit tool-free explanation, failed explanation retry with one business write,
composer preservation, revocation/omit-history gates, summary isolation, request budgets
and Chinese/English remount behavior. Receipts are application data, not orphan tool results.
The existing single-apply tests continue to cover write confirmation and failure boundaries.
No paid model or native browser acceptance was performed for this change.
Validation: 985 total, 984 passed, 1 skipped, 0 failed; historical BUG contracts 17/17.
Muyu plus floating-UI suite: 289/289 passed.

Receipt explanation follow-up: independent task rules and explicit field semantics now
have regression assertions. Full suite: 986 total, 985 passed, 1 skipped, 0 failed;
historical BUG contracts 17/17; Muyu plus floating UI 290/290. External synthetic
DeepSeek harness repeated the three original receipt cases with thinking enabled:
3 requests, 5941 reported tokens. Human review found the previous changed-flag
misinterpretation and inappropriate Provider selectors absent in this run. Answers
remain verbose; this is a targeted comparison, not a general quality guarantee or
browser acceptance. Initial failures remain in the external harness report.

Receipt presentation follow-up adds assertions for concise/explicit instruction rules,
the human confirmation path, single receipt rendering, localized explanation status
and a separate action container in both languages. No permission or write lifecycle
changes. Native layout and live-model brevity still require user acceptance; no paid
requests were made for this presentation-only pass.

Provider adapter v2 adds `muyu-provider-config.test.mjs` plus controller/panel assertions:
structured whitelist/missing/unsupported values, no default filling or render calls,
global-owner and chat isolation, rejected structured selectors/pagination, byte accounting,
invalid payload rejection, mixed snapshot rejection, version/policy gates, diagnostic
permission independent of chat grants, protected-history revocation, and deterministic
receipt checks with no model calls, no repeated writes, preserved drafts and origin views.
Existing eight-source text, pagination and permission regressions remain in the suite.
Local checks use the shared Provider/Broker path, not a parallel configuration tool.
No paid API call or browser layout acceptance was performed in this phase.
Validation: 994 total, 993 passed, 1 skipped, 0 failed; BUG contracts 17/17.
Muyu plus floating-UI suite: 298/298 passed.
