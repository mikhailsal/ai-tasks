# Verification commands and evidence

Use Linux, Node 24.22.0 and npm 11.19.1 (`nvm use` when nvm is available).
Install with `npm ci`. Native prerequisites are checked by `npm run check:runtime`.
Production CLI execution uses compiled `dist/cli.js`, without a TypeScript loader.

| Command                     | Scope                                                             | Budget                            |
| --------------------------- | ----------------------------------------------------------------- | --------------------------------- |
| `npm run typecheck`         | strict server/config/test and browser TypeScript                  | normal compiler completion        |
| `npm run lint`              | boundaries, cycles, types and complexity                          | normal linter completion          |
| `npm run format:check`      | authored code/configuration/documentation                         | normal formatter completion       |
| `npm run test:functional`   | unit, real SQLite integration, compiled CLI and Fastify contracts | 10s/case, 180s/job                |
| `npm run test:contention`   | independent processes and real file/SQLite locks                  | 30s/case, 180s/job                |
| `npm run test:e2e`          | production Chromium/WebKit mobile application                     | 30s/case, 600s/job                |
| `npm run build`             | compiled server entries and production browser assets             | measured; 5s is a goal            |
| `npm run check:bundle-size` | all emitted browser JavaScript, individually gzip level 9         | total strictly below 150000 bytes |
| `npm run bench`             | separate declared workloads                                       | 300s/job                          |

`scripts/run-suite.mjs` saves command, runtime, start time, duration, budget, exit code,
signal and timeout status under ignored `artifacts/checks/`. A timeout exits 124 and
terminates the child process group. Failed or unavailable commands never count as passing.
Use injected clocks for domain time and IPC barriers for overlapping process operations.
The test fixtures use disposable paths; browser checks must never run against personal data.
Install browser binaries with `npx playwright install chromium webkit` before browser checks.

The completed release record is [T107 validation](../docs/validation.md): **1647 functional
cases / 122 files**, **26 independent-process contention cases / 6 files**, and **168
production browser cases** (84 each in Chromium and WebKit) pass their original budgets.
The benchmark and executable quickstart also complete successfully; measured latency goals
remain unmet in the measured VMware guest, as recorded in [performance results](../docs/performance.md).
Story checkpoints below are historical evidence.
Functional workers use `min(6, availableParallelism())`; contention remains serial.
The functional sequencer promotes thin spec files that import actual test registrations
from fixtures, using the registration source size instead of the wrapper size. It preserves
all specifications and keeps the base order for other files and contention tests.
The suite supervisor prunes exited process identities while retaining start-time checks
and tagged-orphan cleanup; its cleanup regressions include detached descendants and an
unrelated process that must survive. These changes retain every case and job deadline.

Browser delivery-loss tests await a real committed response and discard it at `window.fetch`
so service workers cannot bypass the injected loss. Read-error tests use noncacheable HTTP
failures when asserting an error/retry interface; network loss separately exercises saved
read fallback. Explicit retries must retain their original operation ID and serialized body.

## Foundation checkpoint (T021)

The complete foundation gate passed on 2026-10-21 with Linux, Node 24.22.0,
npm 11.19.1 and SQLite 3.53.4. Every database fixture uses production migrations;
compiled CLI/helper and browser checks use disposable databases, with no personal data.
Run suites sequentially when a browser fixture rebuilds `dist/` so live subprocesses
never lose their compiled chunks during another build.

| Exact command                 | Exit | Duration             | Evidence                                                                 |
| ----------------------------- | ---- | -------------------- | ------------------------------------------------------------------------ |
| `npm ci`                      | 0    | 35.45s               | Clean locked install, native dependency subsequently opened successfully |
| `npm run check:runtime`       | 0    | 0.57s                | Node/npm pins and SQLite 3.53.4                                          |
| `npm run build`               | 0    | 3.10s                | All six server entries and production browser assets                     |
| `npm run typecheck`           | 0    | 20.31s               | Strict server/config/test and browser compilation                        |
| `npm run lint`                | 0    | 24.29s               | Architecture, cycles, unsafe types and complexity                        |
| `npm run format:check`        | 0    | 4.30s                | All authored files                                                       |
| `npm run test:functional`     | 0    | 44.623s              | 217 cases across 13 files                                                |
| `npm run test:contention`     | 0    | 3.985s               | Six independent-process lifetime lock cases                              |
| `npm run test:e2e`            | 0    | 32.788s              | Ten production cases across Chromium and WebKit                          |
| `npm run check:bundle-size`   | 0    | 0.32s                | 104262 bytes, individually gzip level 9, strictly below 150000           |
| `npm audit --omit=dev --json` | 0    | Not separately timed | No production dependency findings                                        |

Suite evidence is saved under `artifacts/checks/2026-10-21T18-44-49.504Z-functional.json`,
`artifacts/checks/2026-10-21T18-45-34.539Z-contention.json`, and
`artifacts/checks/2026-10-21T18-45-38.823Z-browser.json`. Static command durations above
were measured with `/usr/bin/time`; suite durations include the bounded runner.

Checks cover migrated storage constraints, immutable history and receipts, replay/scope/
revision/epoch guards, injected time, 5000-event atomic audit commit and late rollback,
compiled CLI input/output and query purity, helper lifetime lock release, graceful service
shutdown, exact Host/Origin/Fetch Metadata, safe JSON errors, no-store static/API responses,
no-auth access, deep links, single-column layout, focus/touch targets and connection retry.
Regression checks also preserve own JSON keys through parsing so changed payloads cannot
collapse into an old receipt fingerprint; unknown command keys remain rejected.

The initial full lint run found that a mixed flat-config object made generated-output
ignores local; splitting global ignores from linter options fixed the authored-source gate.
Focused browser test authoring initially expected the wrong unknown-route error code;
the corrected full ten-case run passes. Earlier failed evidence remains available and is
not counted as a passing run. Shared foundation checks close Setup's pending execution;
user-story behavior remains pending its owning tasks and checkpoints. Benchmarks remain
pending T104; a missing benchmark runner must fail visibly rather than pass an empty suite.

The clean install reports four moderate development-tool findings in drizzle-kit's
transitive esbuild loader chain. The application does not expose esbuild's development
server; this remains unresolved dependency evidence. No forced downgrade or lockfile rewrite
was used to hide findings. Linux browser binaries use Playwright's compatible fallback;
both installed engines passed the actual production checks.

## Evidence format

For each checkpoint, record the exact command, relevant environment/runtime, exit code,
duration, result summary, artifact paths, and pending/failed limitations. Preserve useful
failure output, then record the successful rerun separately. Full release evidence belongs
in `docs/validation.md` at T107. No Git hooks may be bypassed.

## US1 test authoring (T022–T024)

The first story test wave is authored: 68 ordinary-work integration cases, 50 emoji/
Markdown cases, 38 CLI/HTTP contracts and eight browser journeys. These counts describe
authored assertions, not passing story behavior. Core modules T025–T029 now pass their source checks; adapters T030/T031 and screens
T032–T034 remain pending; missing modules are not behavior evidence.

Actual red assertions against the working foundation were observed before implementation:
compiled `project create` exited 2 with `VALIDATION_ERROR` where success exit 0 was required;
real HTTP project creation returned 404 instead of 201; real description preview returned
404 instead of 200; production Chromium lacked the required “Создать проект” button.
Focused cases used migrated disposable files, actual compiled entries/helpers and normal
security headers. Other cases were deliberately filtered while their production modules
were absent; no skip/todo placeholder is treated as implemented coverage. T035 must execute
all owning suites and the regression gate before accepting the ordinary-work slice.

T025–T028 source checks now pass: 34 emoji cases, 46 configuration/preset cases,
17 renderer/preview/cache cases, seven project-only creation/rollback/replay cases and
11 project-read/lifecycle cases. The latest combined project-read/kernel/config/emoji run
passed 120 cases in 3.73s; scoped strict compilation and lint pass. Direct-core requests
now enforce the same 1 MiB ceiling as transports, after an actual acceptance regression.
Root and web strict compilation, full lint and formatting now pass. CLI/HTTP story routes
and screens remain pending. Basic pagination binds normal scope/query/epoch/read revisions and
retains as_of; adversarial cursor integrity is explicitly pending T080, not accepted yet.

T029 source checkpoint: the complete unit/integration source run passed 405 cases across
18 files in 12.76s. The two filtered cases require the T030 compiled project-create command
and T031 HTTP description-preview route; they are explicitly pending. Ordinary create/edit/
transition/archive/restore, all configured edges and confirmation, nullable exact priority/
deadline, source preservation, dependency guards, task query isolation and rollback pass.
Actual failing regressions exposed SQL OR precedence leaking scope, missing prerequisite
configuration silently dropping blockers, obsolete-policy HTML escaping on reads and lone
UTF-16 surrogates changing in SQLite. Each now has passing regression coverage. Malformed
Unicode is rejected before writes; legitimate combining and non-BMP source stays exact.

T030/T031 compiled adapter checkpoint: `npm run build` succeeds; the full bounded
`npm run test:functional` run passes 507 cases across 25 files in 140.907s
(180s budget, exit 0), with no skipped cases. Evidence:
`artifacts/checks/2026-10-21T19-44-27.737Z-functional.json`. This includes the 38 US1
CLI/HTTP contracts, actual compiled project creation and hostile Markdown preview,
plus the compiled migration rendering-policy refresh regression. Strict root/web
typecheck, full lint and formatting also pass. The compiled package bin is executable
(mode 755) and `./dist/cli.js version --json` emits exactly one success document.
The current shell-only browser bundle is 104290 gzip-level9 bytes; story screens and
T035 browser verification remain pending. Source parser regressions preserve unknown
query fields and reject malformed raw UTF-8 before source can be rewritten.

T034 source checkpoint: 11 focused draft/proposal tests pass, along with full typecheck
and scoped lint/formatting. Drafts preserve their original source revisions; proposal
storage is separate and never sends automatically. A persisted uncertain operation
retains its immutable ID/body across reload for explicit retry before any changed write.
Actual IndexedDB/reload and screen conflict interactions remain T035 browser obligations.

A targeted server packaging change now bundles/tree-shakes Drizzle and Zod ESM barrels,
while keeping better-sqlite3 native/external. The post-change bounded compiled/core run
passed 161 cases in 55.308s, exit 0, artifact
`artifacts/checks/2026-10-21T19-49-54.330Z-functional.json`. One cold version probe fell
from 1.18s to 0.34s under concurrent development load; this is a diagnostic observation,
not the calibrated T104 benchmark or a passed performance goal.

T035 regression progress: `npm run test:functional` passes 545 cases across 29 files
in 91.422s (exit 0, 180s budget), artifact
`artifacts/checks/2026-10-21T20-15-51.219Z-functional.json`. The sequential
`npm run test:contention` passes all six lifetime-lock cases in 3.814s (exit 0), artifact
`artifacts/checks/2026-10-21T20-17-23.005Z-contention.json`. These runs include 20 new
production-command marker/lifecycle/project-guard/audit cases; helper-only emoji
scenarios are not substituted for actual command coverage.

The first joined Chromium run found duplicate pending/error announcements, clipboard
permission denial and insufficient completion wording. Subsequent real browser regressions
reproduced missing restore controls with an archived dirty draft, two simultaneous form
submissions storing two tasks, discarded stale lifecycle consent, a new-epoch retry loop,
and hidden draft cleanup failure after a known successful save. Each regression now passes;
the full-page navigation response race was fixed with in-app navigation. All 42 browser
cases (21 each in Chromium and WebKit) pass in 117.238s, exit 0, no skips, artifact
`artifacts/checks/2026-10-21T20-20-46.899Z-browser.json`. A separate marker-return race
proved the explicit ⚪ choice must be submitted even after the previous marker becomes free.
Useful RED artifacts are the browser records at 20-08-43.934Z (project cases),
20-10-57.877Z (archived draft), 20-12-10.394Z (duplicate create/stale consent). Earlier
missing-scope/permanent-marker setup failures were repaired and do not count as behavior
evidence. After the shared RFC3339 lowercase-input consistency fix, the browser bundle
measures 121098 gzip-level9 bytes, below the strict 150000-byte budget. The timestamp
regression preserves original request spelling for idempotency while returning canonical UTC.

Ordinary-only demonstration at T035 (later stories remain required):

Use a disposable database for the manual demonstration:

```bash
npm run build
task_demo_dir=$(mktemp -d)
export AI_TASKS_DB_PATH="$task_demo_dir/demo.sqlite"
node dist/migrate.js
node dist/cli.js serve --all-projects --json
```

1. Open `http://127.0.0.1:3000/projects` on a narrow viewport.
2. Create a project with a meaningful emoji and one of the four priority presets. Create
   an ordinary task with raw Markdown, a model-compatible priority, and an exact deadline.
   Switch between source and the server-rendered preview, then copy the project marker.
3. Advance along configured edges; on completion, supply the actual confirmation text.
   Archive and restore a task, exercising occupied-marker return choices. Archive/restore
   the project with the complete child revision list; ordinary child state stays intact.
4. Open the same task in the CLI, retain its revisions, edit from another client, and submit
   the stale proposal. The UI retains its source and original base for explicit comparison
   and revised retry. An uncertain response can be retried with the exact saved operation
   ID/body after reload, producing the original receipt and one stored task.

This demonstrates ordinary work only. Configuration migration/dependency editing, audit
browsing, recurrence, aggregate queries, offline reads, backup/recovery and release
acceptance remain the subsequent required task gates.

The final post-timestamp-fix functional run passes 554 cases across 30 files in 93.534s
(exit 0, 180s budget), artifact
`artifacts/checks/2026-10-21T20-26-57.800Z-functional.json`. All relevant source regressions,
compiled CLI and HTTP contracts pass, with no skipped tests.

US2 tests-first evidence (T036–T038; behavior implementation still pending): a valid
compiled `config preview` exits 2 instead of 0 (T036, 3.10s); valid `dependency add`
first verifies compiled `version --json`, then exits 2 instead of 0 (T037). The HTTP
preview fixture successfully creates projects/tasks and reads presets/current config before
its actual preview route returns 404 instead of 200 (T038, focused run 4.00s). Missing
future imports are not counted as RED. Opposing dependency CLI processes reach the actual
barrier/result assertion, returning [2,2] instead of [0,4]; final graph-race acceptance
remains pending implementation. Focused RED logs: `/tmp/ai-tasks-t037-dependency-red.log`
and `/tmp/ai-tasks-t037-contention-red.log`.

T039–T042 core checkpoint: 98 selected source cases pass across configuration migration,
preview validation, dependencies and shared priority/workflow policy (10.76s); the two
compiled dispatch cases remain for T043/T044 and are excluded only by the explicit focused
name filter. Pure previews do not stage writes; commit checks the same projected state.
An additional actual RED found that oversized direct previews leaked a ZodError instead
of the domain VALIDATION_ERROR; the shared body schema now passes through the safe core
parser, and both size/own-**proto** regressions pass. New migration source lint and full
typecheck pass; a separate bounded read-only review found no confirmed correctness issue.
US2 whole-suite, transport/browser and actual opposing-edge acceptance remain T047.

T043/T044 compiled checkpoint: the joined selected 154-case core/adapter run passes
152 cases and exposes two inconsistent unknown-member test expectations (actual
TASK_NOT_FOUND/HTTP404/CLI3, as required by the shared registry and integration owner).
Corrected tests pass both transports in a focused rerun (4.69s); no production behavior
was weakened. Initial selected artifact: 2026-10-21T20-48-34.909Z-functional.json.
The full contention command now passes seven cases across two files in 8.592s, exit0,
artifact `artifacts/checks/2026-10-21T20-50-17.458Z-contention.json`. Two distinct compiled
CLI processes released by the real barrier commit exactly one edge/parent revision,
reject the opposing edge with DEPENDENCY_BLOCKED, and retain one audit/receipt.
US2 mobile forms and final joined story checkpoint remain in progress.

The pre-UI full regression executes 711 cases in 101.841s:707 pass; the failures are
three newly authored T046 retry-helper RED cases plus the former US1-only exact config
subcommand inventory. The inventory now explicitly includes preview/migrate/dependency;
nested action suffix/intent fixes have their own focused GREEN. This intermediate failed
run is retained as `artifacts/checks/2026-10-21T20-52-36.577Z-functional.json`, never called
a passed whole-suite gate. Final T047 regression includes the completed UI helpers.
Migration validation was also batched to read each current project workflow once and reuse
a minimal task projection;89 relevant source cases pass afterward (11.94s), with strict
TypeScript/lint/formatting clean. No production behavior or policy limit changed.

T045/T046 source verification adds13 pure configuration-editor scenarios and8 task-action
identity scenarios. Actual RED cases exposed named-ID `unset`/null confusion, optional
mapping loss during preview, nested dependency removal truncation and dirty-draft retry
intent. Focused regressions pass; actual IndexedDB/storage and dependency stale/lost-response
journeys are authored for both browsers. Configuration conflict comparison includes both
workflows and consent flags; local draft-save failure has an explicit persistence retry.

The first T047 production build correctly rejected the missing browser allowlist entry for
the new pure configuration-migration schema. That module was reviewed and explicitly
allowlisted; no server-module boundary was weakened. The prematurely started browser run
was stopped before acceptance and is not RED/pass evidence (artifact21-10-41.354Z). The
corrected full build succeeds and exact gzip-level9 JavaScript measures130703bytes
(`assets/index-CRa_gqiM.js`), strictly below150000. Browser acceptance remains in progress.

T047 initial actual production acceptance passes all12 new Chromium journeys in46.132s
(exit0), artifact `artifacts/checks/2026-10-21T21-13-00.348Z-browser.json`: structured
invalid/valid custom creation and configured consent, all4 models/null clearing, complete
archived migration revisions, explicit stale-config review, commit-time marker collision,
real IndexedDB failure/retry/reload, and dirty-field stale/lost dependency removal replay.
The initial stopped-run server-cleanup issue was verified as an owned disposable process
tree and terminated; the subsequent port-in-use harness record21-11-32.572Z is not behavior
evidence. Runner interruption cleanup is receiving a real detached-process regression.
The full two-engine run and final whole-suite checkpoint remain pending.

The first complete T047 browser run passes64/66 in159.473s; both failures are the
old archive assertion ambiguously matching the task notice and the new dependency notice,
with correct read-only UI in both engines. The assertion now names the task notice exactly;
no production behavior changed. Artifact:2026-10-21T21-13-59.177Z-browser.json.
A full rerun is pending.

Runner cleanup now has3 real-process regressions (4.97s): interruption, ordinary leader
completion and immediate leader exit all terminate owned detached descendants while an
unrelated process survives. The old runner's actual leaked-process assertions are retained
in `/tmp/ai-tasks-suite-cleanup-red.log`. Linux ownership uses private inherited per-run
markers and PID/start-time verification; process environments are never printed.

T047 joined checkpoint passes:732 functional cases across38 files in94.000s
(`artifacts/checks/2026-10-21T21-22-01.302Z-functional.json`),7 independent-process
contention cases in6.680s (`2026-10-21T21-23-35.637Z-contention.json`), and all66
Chromium/WebKit browser cases in178.742s (`2026-10-21T21-18-52.103Z-browser.json`).
All commands exit0 within their declared budgets, with no skipped tests. Full strict
typecheck, architectural lint and formatting pass. Production build and exact bundle
check pass at130703 gzip-level9 JavaScript bytes. This closes ordinary configuration and
dependency acceptance; recurrence, history, read views, offline/recovery and release gates
remain required.

US3 tests-first: valid same-host audit GET returns404 ROUTE_NOT_FOUND after real
compiled-helper metadata succeeds200 (T050;2.80s). Pagination integrity has4 actual RED
assertions: modified server as_of, replay offset and huge offset are accepted, and a token
from another DB with copied public epoch/read revision is accepted. Two control cases pass
(clock stability over a new connection and forbidden caller clock/context). Artifact
`artifacts/checks/2026-10-21T21-25-28.924Z-functional.json` (3.847s); focused log
`/tmp/ai-tasks-pagination-integrity-red.log`. No missing module, route-control setup error or
failed executable is counted as behavioral RED. Implementation awaits the complete US3
test-authoring wave.

T049 authored/executes13 new actual-process contention cases:8 write cases pass in15.843s
(artifact`2026-10-21T21-29-50.557Z-contention.json`),5 marker races pass in12.640s
(`2026-10-21T21-30-47.441Z-contention.json`). Independent pre-opened compiled data helpers
use separate PIDs/connections and real barriers. Tests observe native busy waiting, then
release or actual5000ms exhaustion with DB_CONFLICT, unchanged failed state/audit/receipts,
same-operation exact replay and changed-ID-content conflict, stale whole/disjoint edits,
stale config tokens, and independent successful writes. Marker races cover same-project
create/update conflicts, independent task namespaces, permanent project ownership after
archive and simultaneous global project versus task claim. One old fixture submitted
unneeded affected rows for a label-only migration; correcting that setup is not RED.
Current production behavior passes these assertions; no artificial failing assertion was
invented. All helpers/locks close before fixture deletion. Joined US3 acceptance remainsT057.

T048 inventory authoring is complete:43 application CLI commands,42 HTTP routes and4
informational forms, with23 accepted ready rows,1 required US3 target and19 explicit later
story rows. Every pending row has an owning story/reason; no skip/todo hides it. The
focused matrix executes15 ready/inventory cases successfully;2 audit target assertions
fail after compiled metadata controls (actual CLI exit2/HTTP404 instead of0/200). The
initial focused17-case run takes30.34s; ready-only post-fixture-batching verification
passes15 in17.56s. Strict TypeScript, scoped lint and formatting pass. All historical
required endpoint rows must become ready before release acceptance.

T050 authoring joins the US3 test wave:23 history/HTTP scenarios and3 browser journeys
(6 engine cases) cover immutable timestamp/UUID pagination, meanings after removed statuses,
actual consent, historical absent owners, nullable captured revision, explicit filters and
query purity; real Host/Origin/Fetch Metadata/body/error boundaries and real Vite proxy.
Eight existing security/error scenarios pass in7.82s. Valid HTTP audit404 is the actual
behavioral RED;15 audit-dependent cases await implementation, not a green whole-suite claim.
Browser tests are discovered but not yet executed. Scoped lint/format/TypeScript pass.
T048/T049/T050 now complete; T051/T052 implementation may begin.

T051 pure history source acceptance passes22 cases (16.75s), with only the known pending
HTTP route explicitly excluded from the focused run. It preserves exact immutable snapshots,
old-epoch history and historical absent owners without live lookup. Full typecheck and
scoped lint/format pass. T052 authenticates version2 cursors using a migration-created private
256-bit key; the public epoch is not its key. Altered payload/signature and cross-database
tokens fail validation; valid stale context still returns CURSOR_STALE. Queries never write
or expose the key. All71 pagination/storage/project-read cases pass in5.665s, artifact
`2026-10-21T21-36-56.453Z-functional.json`. Independent review found one SQLite NUL CHECK
gap; an actual constraint RED was captured (`21-36-19.715Z`), then the new unreleased0001
constraint was fixed with text/NUL validation. Existing0000 migration is unchanged.

Additional actual T053 supervision RED (`2026-10-21T21-34-31.460Z-functional.json`):
compiled serve emits valid readiness, an ancestry/PID-start-time-verified helper is killed,
and the CLI remains running beyond the bounded behavioral condition instead of reporting
failure. Normal shutdown and intentional maintenance closure both pass. No missing binary
or suite timeout counts as RED. Runtime implementation follows T051/T052.

T053 startup/meta/static and DB-free supervision checkpoint passes19 compiled bootstrap/
supervision cases in14.82s (`2026-10-21T21-39-40.746Z-functional.json`) after one server
build. Unexpected real helper death now propagates one safe error/nonzero CLI exit after
one readiness line, with no leaked database path or extra stdout; normal SIGTERM exits0.
Intentional helper closure still serves the shell with data requests returning MAINTENANCE,
releasing its shared lifetime lock. Metadata/static routes are cohesive modules and API
unknown paths remain JSON404. Strict TypeScript/scoped lint/format pass. Audit adapters and
UI follow; no recovery job behavior is claimed at this checkpoint.

T054/T055 compiled adapter checkpoint passes all59 selected matrix/history/bootstrap/
supervision cases in25.217s after the coordinated server build, artifact
`2026-10-21T21-43-29.533Z-functional.json`. Both actual audit target RED assertions now
pass (CLI0/HTTP200), including historical scopes/query purity and unchanged startup semantics.
The command inventory marks24 rows accepted and19 later-story rows pending. No current
US3 command/route pair remains a target. UI acceptance and final joined US3 checkpoint
remain T056/T057; new source CLI filter/inventory cases also pass16 (3.086s).

T056 source/UI wiring is complete with strict typecheck/scoped lint/format green. A pure
formatter regression captures and fixes ambiguous workflow meanings when ordinary and
recurring statuses share an ID. Four real-browser cases are authored/discovered for saved
old meanings/consent, exact wrapped source, filters, successful constant-as_of paging and
real-write stale-page refresh; execution remains the joined T057 gate.

The first full US3 regression passes786/787 in102.647s; the only failure is the new
command-matrix case batching every ready read through both adapters exceeding its10000ms
case budget under whole-suite load. Artifact`2026-10-21T21-49-29.553Z-functional.json`.
This is harness batching, not production behavior RED. The case is split per command,
retaining both adapters, every assertion and unchanged time limits; a full rerun follows.
Contention was not started by the failed chained command.

T057 pre-browser whole checks pass797 functional cases/43 files in96.019s
(`2026-10-21T21-51-44.787Z-functional.json`) and20 real contention cases/4 files
in27.355s (`2026-10-21T21-53-21.119Z-contention.json`). The per-command read matrix
retains both transports with every case below its unchanged10s budget. Full production
build, strict TypeScript, architectural lint and formatting pass. Browser JavaScript is
461970bytes raw /134104bytes gzip-level9 (`assets/index-TA6R0LMT.js`), below150000.
All10 new Chromium/WebKit audit/delivery cases pass in38.883s
(`2026-10-21T21-56-04.169Z-browser.json`), including actual Vite proxy reads/writes.
The full76-case browser regression remains in progress before T057 closure.

T057 joined US3 checkpoint passes all76 Chromium/WebKit production browser cases in
173.019s, artifact`2026-10-21T21-56-55.415Z-browser.json`. Together with797 functional
cases/43 files (96.019s),20 real contention cases (27.355s), full strict typecheck/lint/
format/build and134104 gzip-level9 browser JavaScript bytes, this closes US3. All commands
exit0 within unchanged budgets and no tests are silently skipped. Accepted automation,
semantic history, independent writer races, runtime failure/drain and explicit stale
pagination are independently demonstrable. Recurrence/settings, aggregate read views,
offline/recovery and release acceptance remain required subsequent gates.

## US5 tests-first wave (T058–T061)

Calendar/generation, occurrence-outcome and lifecycle matrices are authored against production migrations and real SQLite. Compiled recurring creation fails at a real assertion after successful metadata/epoch controls: CLI exits2 for a valid recurring payload while0 is required. T060 artifact `2026-10-21T22-04-58.901Z-functional.json`; adapter artifact `2026-10-21T22-09-51.777Z-functional.json` (6.042s). These are observed behavior failures, not missing-module or executable errors. Later lazy source calls, real process recurrence races and ten Chromium/WebKit journeys remain pending implementation; they are not claimed executed or passing. No completed story checkpoint is implied by authoring this wave.

T062/T063 input and pure calendar/elapsed implementation passes51 focused cases (1.582s wrapper, artifact `2026-10-21T22-21-31.124Z-functional.json`). T064 storage primitives pass26 real SQLite cases (4.650s wrapper, `2026-10-21T22-24-13.344Z-functional.json`), strict typecheck and scoped lint/format. Configured command-level old-anchor reconciliation remains T065/T067 integration; no whole-US5 acceptance claimed. T060 fixture clocks were corrected to activate before simulated downtime; draft intervals do not become retroactive active periods.

T065 explicit tick/expiry passes37 real SQLite cases in7.030s (`2026-10-21T22-28-59.723Z-functional.json`) plus4 boundary regressions in3.430s (`2026-10-21T22-29-10.698Z-functional.json`). Whole source/web typecheck and scoped architectural lint/format pass. Tick bounds total processing at128, validates all selected parents before writes, checkpoints skipped inactive anchors, retains one future period and captured miss provenance. Boundary review fixed final-slot continuation and frozen audit context. Full original recurrence story suites remain pending command/lifecycle/adapter prerequisites.

T066 source outcomes/snapshots pass90 cases (11.747s wrapper; the one compiled creation case explicitly remains pending T068/T077). Four strengthened private completion regressions pass in3.148s, including exact historical parent/checkpoint equality, captured miss/completion audit, a real trigger proving invalid batch validation occurs before writes, paused actual-derived candidate, and one backdated successor/replay. All30 selected cancellation cases pass separately. Source/web typecheck and scoped architectural lint/format pass. The equal-actual elapsed successor collision has observed real SQLite RED→GREEN; the calendar collision invariant remains.

T067 joined source lifecycle gate passes92 real SQLite cases across6 files in10.934s, artifact `2026-10-21T22-47-05.773Z-functional.json`; strict source/web typechecks and architectural lint pass. This includes18 configured-control,21 resume,12 retirement and41 tick/expiry/boundary cases. Direct TaskRestore adapter acceptance remains T068/T077; the underlying configured restore control now proves exact consent and paused-only behavior. Long-pause reconciliation had2 genuine behavior RED assertions (`2026-10-21T22-42-26.083Z-functional.json`) before fixing inactive skip accounting; no old owed obligation is forgiven and no new old-generation future row is created on retirement. Calendar resume preserves phase across126 years, month-end and whole-day timezone transitions without day-by-day gap enumeration.

T068 compiled/source gate passes163 ordinary/outcome/recurring-task cases in14.790s (`2026-10-21T22-52-43.854Z-functional.json`) after a coordinated successful server build. Both original compiled recurring-create RED assertions are now GREEN. Sixteen ready generation cases pass6.317s (`2026-10-21T22-53-28.750Z-functional.json`); three get/timezone cases explicitly await T070/T071. Five compiled CLI/HTTP creation/direct restore cases pass10.338s (`2026-10-21T22-53-35.507Z-functional.json`); the other20 new recurrence/settings adapter cases explicitly await T073/T074. All38 existing compiled ordinary contract cases pass54.126s (`2026-10-21T22-53-46.183Z-functional.json`). Full source/web typecheck and scoped lint/format pass. Creation captures the initial recurrence in immutable audit even before any occurrence exists. No missing future command/import is accepted as RED or closed by this gate.

T069 joined gate passes162 real SQLite cases/9 files in15.602s (`2026-10-21T23-10-59.413Z-functional.json`), including ordinary configuration/project lifecycle regressions, plus54 compiled CLI/HTTP configuration/dependency contracts in59.481s (`2026-10-21T23-11-39.319Z-functional.json`) after a successful coordinated server build. Strict source/web TypeScript and scoped architectural lint/format pass. Pure previews and atomic mappings now use the same bounded recurrence validation; project archive validates all child revisions and retirement guards before closing intervals, and restore administratively pauses preserved active children without automatic activation. Actual paused→draft→active RED regressions in both control and configuration migration now pass; active/paused history and continuation checkpoints prevent historical seed replay. No settings/query/worker acceptance is claimed before T070–T077.

T070 timezone source gate passes119 recurrence lifecycle/tick/resume/control/retirement/settings cases in17.896s (`2026-10-21T23-17-46.111Z-functional.json`), including the full T060 lifecycle suite. The final historical-horizon correction passes all24 focused timezone cases in6.618s (`2026-10-21T23-19-00.339Z-functional.json`); three genuine pending/completed/cancelled history REDs (`2026-10-21T23-18-08.659Z-functional.json`) now pass. Both original T058 timezone tests pass3.605s (`2026-10-21T23-18-46.254Z-functional.json`); the other17 cases were explicitly filtered in that focused run, with the pure recurrence get case still owned by T071. Settings are pure on read and global/atomic on write, retain frozen stored instants, preserve unresolved local cadence across repeated zone changes, respect all historical parent horizons, and never activate archived projects. Old-zone work shares a128-step budget and no new old-generation future row is invented. Lifecycle retirement retains half-open interval semantics; timezone continuation separately includes an old anchor due exactly at the effective clock because new-zone anchors start strictly later. Same-zone acceptance records audit/revision without redundant generations. Adapter/UI/worker acceptance remains pending T071–T077.

T070 final strict source/web TypeScript, scoped architectural ESLint and formatting checks pass after the historical-horizon fix.

T071 pure query gate passes25 recurrence-resource/generation cases in8.44s (`2026-10-21T23-22-10.006Z-functional.json`),23 due-work/retirement/boundary cases in6.326s (`2026-10-21T23-22-47.149Z-functional.json`), and7 final due-work cases including the new query-count regression in5.062s (`2026-10-21T23-22-50.571Z-functional.json`). Full source/web typechecks and scoped ESLint/format pass. Original T058 get/timezone prerequisites are now all ready/passing. Persisted outcomes and frozen HTML/schedule snapshots remain pure even after a window elapses; signed pagination retains as_of and rejects stale contexts. Real SQLite prepare spies prove that listing20 occurrences and discovering20 parents each use the same statement count as one. Due discovery batches light parent/current-generation, expiry, active-interval and future-anchor associations, includes paused old arrears/strict expiry and active future precreation, and returns current tokens with bounded selections/has_more. No worker timer/compiled adapter/browser evidence is claimed yet.

T072 worker gate passes24 cases across3 files in12.598s after the final coordinated server build (`2026-10-21T23-29-41.884Z-functional.json`). Ten compiled process cases cover real startup processing,150-day backlog beyond128 anchors, one readiness stdout line, fixed operational stderr, isolated project actor/origin, archived inactivity, invalid scope/actor errors, SIGTERM and IPC drain, and exclusive-lock acquisition with the same stable lock inode after child closure. Ten isolated runtime cases prove serialized immediate continuation/30-second waiting, no overlap, shutdown races and callback failure cleanup using fake timers (no real30-second timing claim). Four realDB callback cases prove custom UUIDv8 identities from the exact scoped request, exact receipt replay, fresh proposals after an actual competing compiled CLI write, and project archive between discovery and tick without stale worker audit/receipt. Strict source/web typechecks, scoped architectural lint and formatting pass. Runtime owns only events/timers/callback orchestration; CLI owns the locked connection and core discovery/commands. Supervised service worker registration and the complete adapter/browser gate remain T073–T077.

T073/T074 adapters are source-accepted:53 CLI input/parser cases pass6.141s; full source/web TypeScript and scoped architectural lint/format pass. Coordinated server build succeeded. The first25-case compiled recurrence/settings parity run passes23 with two authored test-expectation failures (`2026-10-21T23-33-32.004Z-functional.json`,56.368s): a new completion operation reused a stale selected-occurrence token but expected domain validation before revision checks. Core precedence is unchanged/correct. The corrected two CLI/HTTP cases pass12.41s (`2026-10-21T23-35-15.071Z-functional.json`), now separately asserting stale occurrence REVISION_CONFLICT and completed-state VALIDATION_ERROR with fresh tokens, preserving exact receipt replay and rollback snapshots. Thus every25 authored adapter case has executed successfully across the focused runs; no single all-green full25-run is claimed yet. T077 will rerun the complete story. All10 recurrence/occurrence/settings operations share core commands/read projections; six HTTP mutations use200 and settings updates usePATCH. CLI --state is restricted to occurrence lists, with strict unknown/duplicate flag/body validation. Browser UI and service supervisor acceptance remain T075–T077.

T075/T076 source acceptance passes13 structured recurrence-field cases,25 editor/draft/time
cases, and3 real SQLite task-form integration cases. The latter call actual web task-model
functions and core commands: recurring creation supplies required rule/first/policy/window,
content-only edits omit timing and preserve every generation/checkpoint/interval/occurrence,
and legacy ordinary drafts retain their deadline behavior. Browser acceptance is still
pending; the first18-case run passed8 and exposed label/acknowledgment bugs plus fixture
activation and client-before-server cleanup errors, artifact
`2026-10-21T23-54-18.146Z-browser.json` (123.306s). None is reported as a passing story gate.

Timezone UI conflict coverage exposed guard precedence when both settings and parent tokens
are stale. Entity existence/ownership is checked first, followed by applicable settings,
entity revision and project configuration. Epoch-before-receipt and exact receipt replay are
unchanged. A real failing settings-scope assertion now passes;20 focused configured-control/
guard cases pass6.542s (`2026-10-21T23-45-00.036Z-functional.json`), followed by56 mutation-
protocol/ordinary-guard/timezone cases pass10.770s
(`2026-10-21T23-46-00.144Z-functional.json`). An updated settings token with an old parent
still yields REVISION_CONFLICT, and failed writes retain exact state/audit/receipt snapshots.

T075/T076 UI checkpoint closes with all18 distinct Chromium/WebKit cases passing across
focused runs. The17/18 run (`2026-10-22T00-00-14.117Z-browser.json`,81.692s) had one
Chromium teardown timeout after every outcome assertion passed. Waiting for the acknowledged
completion's follow-up refresh to release the next-action control makes both manual-tick/
selected-debt cases pass (`2026-10-22T00-01-52.429Z-browser.json`,21.574s). A single full
all-green browser regression is still required at T077. Actual settings edits attribute to
an archived project without rewriting saved instants or elapsed rules; lost responses retry
identical persisted operations once after reload, untouched debts remain exact, and local
actual-time drafts retain their original zone through settings conflict/reload. Manual tick
conflict reconciliation preserves tick intent and never configures a schedule. Scoped
strict TypeScript/lint/format and production build pass; emitted JavaScript is504790 raw /
145103 gzip-level9 bytes (`assets/index-D1ah_vyl.js`), below150000. Background service
worker supervision and joined story/race regression remain T077.

T077 adapter prerequisite rerun passes all25 compiled recurrence/settings parity cases in one
run,53.265s (`2026-10-22T00-02-55.260Z-functional.json`). This replaces the earlier split-run
acceptance limitation. A new genuine supervision RED after real compiled serve readiness
shows an expired paused occurrence remaining pending rather than becoming captured debt
(`2026-10-22T00-03-06.010Z-functional.json`,5.610s). Worker registration follows that actual
behavior failure; no missing import, executable or timeout is used as domain RED.

T077 expanded command inventory and generic purity gate passes31 cases in25.600s
(`2026-10-22T00-04-16.214Z-functional.json`):35 accepted rows and8 explicit US4/US6
pending rows. The four additional recurrence/settings reads use a real active parent and
occurrence through compiled CLI and HTTP; before/after purity snapshots include generation,
checkpoint, interval and occurrence tables. Existing ordinary lifecycle affected sets remain
independent from this lazy read preparation.

Two integration review findings have actual Chromium/WebKit RED assertions before their
fixes: a settings conflict still compared alpha after selecting beta, and a failed background
recurrence GET silently displayed the old resource. Artifact
`2026-10-22T00-06-28.870Z-browser.json` (43.596s); original diagnostic contexts are retained
under `artifacts/red/2026-10-22T00-06-28-browser/`. Their fixes must pass the final T077 gate;
these failures are not hidden by the earlier focused UI acceptance.

T077 full strict typecheck/lint/format/build gates pass. Browser JavaScript is506089 raw /
145439 gzip-level9 bytes (`assets/index-qW20uEyh.js`). All6 new Chromium/WebKit integration
cases pass38.224s (`2026-10-22T00-14-58.802Z-browser.json`), including the two actual RED
regressions and atomic archive refusal with reachable debt/future blockers. Runtime source
also passes10 coordinator/actual-paging cases in4.710s
(`2026-10-22T00-11-30.214Z-functional.json`): startup/interval races, bounded stale-scan
deferral over201 active projects, immediate cancellation of stalled discovery, consumption
of later IPC rejection, no late child startup, and draining all acquired worker handles.

The first whole-US5 functional run passes1264/1271 in140.166s, below180s
(`2026-10-22T00-15-40.522Z-functional.json`), with7 explicit failures. Four are the old
4s fixture readiness deadline under8-file process load; only that internal allowance becomes
8s, below production15s, while case10s/job180s and post-ready shutdown checks remain fixed.
Two compound cases exceed10s: the full1200-day/1202-anchor catch-up and a multi-operation CLI
journey. They are split into bounded cases preserving every original anchor, exact replay,
outcome, frozen detail and purity assertion, rather than increasing the case timeout. One
old direct-storage task-read fixture lacks recurrence_state, which current recurring detail
correctly requires; the fixture now supplies it and its purity snapshot includes every
recurrence table. All11 focused task-query cases pass4.082s
(`2026-10-22T00-19-01.668Z-functional.json`). Whole regression rerun remains mandatory;
contention/browser chained after the failed run did not execute.

T077 joined US5 checkpoint PASSES:1280 functional cases/79 files in141.272s
(`2026-10-22T00-21-06.182Z-functional.json`),23 independent-process contention cases/5 files
in33.678s (`2026-10-22T00-23-27.802Z-contention.json`), and all100 Chromium/WebKit browser
cases in246.430s (`2026-10-22T00-24-01.828Z-browser.json`). Each command exits0 within its
unchanged suite/case budgets. Full strict source/web typecheck, architectural lint, formatting,
production build and145439-byte gzip-level9 JavaScript gate pass; test-only bounded-case and
fixture corrections additionally pass scoped type/lint/format. Actual server startup now
processes recurrence before readiness with ai-cli:<slug>/recurrence-worker attribution,
suppresses child readiness output, supervises unexpected worker death, and drains all workers
before the API data helper. Real normal/failure shutdown permits exclusive flock only after
all copied-database children close and retains the stable lock inode. Ordinary-only copied
storage, including a real ordinary task, remains byte-for-byte equivalent in domain snapshots.
All35 ready command inventory rows are accepted;8 US4/US6 rows remain explicitly pending.
The complete1200-day/1202-anchor history remains covered by six ordered bounded cases, and all
29 recurrence/settings adapter cases pass in the joined run. No later read-view, offline,
backup/restore or release checkpoint is implied by US5 completion.

US4 T080 retains the existing project-first SQL pager and extracts its strict input into browser-safe `src/schema/task-query.ts`. The original task-query suite passes 11/11 (`2026-10-22T00-45-13.836Z-functional.json`, 8.038s); the combined ready/read selection passes 14 assertions (`2026-10-22T00-43-07.037Z-functional.json`, 7.921s), including all six ready US4 read/filter/query-plan cases. Strict server TypeScript and scoped ESLint pass after the exact-optional input correction. Later view assertions remain pending implementation.

US4 tests-first authoring (T078/T079): 16 source read/plan cases, 10 ordinary completion-recording cases, 31 CLI/HTTP contract cases, and eight discovered Chromium/WebKit browser cases were authored before the new query implementation. The completion test performed a successful real transition into completed then failed its missing recording-fact assertion (`2026-10-22T00-30-59.677Z-functional.json`,2.410s); the complete ten-case file initially had nine missing-fact failures and one strict public-input rejection pass (`2026-10-22T00-31-34.589Z-functional.json`,4.330s). The HTTP feature assertion first verified metadata200, then observed agenda404 versus expected200 (`2026-10-22T00-31-10.139Z-functional.json`,3.471s). Missing modules/imports are not counted as behavioral RED evidence. Types, scoped lint/format and browser discovery passed at the authoring gate; full story acceptance remains pending T087.

US4 T081 shared SQL paging/grouping and the new agenda/priorities queries pass the joined 28-case source gate with original task queries and real SQL-plan checks (`2026-10-22T00-54-31.639Z-functional.json`,37.765s). The agenda midnight-gap regression first failed for America/Santiago (`2026-10-22T00-49-34.699Z-functional.json`) and now passes with independently resolved calendar-date starts. The preceding pagination failure (`2026-10-22T00-48-24.778Z-functional.json`) exposed a fixture that advanced past midnight on every page while expecting equality on refresh; the continuation now fixes the clock at the exact next midnight, preserving deadline/midnight crossing, stable as_of, all-row equality, uniqueness and fresh reclassification assertions. A simultaneous schema/migration edit temporarily prevented fixtures opening (`2026-10-22T00-52-45.522Z-functional.json`); this is recorded as a prerequisite failure, not behavioral evidence. Scoped query lint/format, focused strict Node types and independent read-only review pass.

US4 T082 adds nullable internal ordinary completion recording via additive migration0002, atomic transition/configuration writes, conservative legacy backfill, and SQL-grouped per-metric statistics. The ten recording protocol cases pass (`2026-10-22T00-53-45.807Z-functional.json`), as do three upgrade/storage cases (`2026-10-22T00-55-55.350Z-functional.json`). The joined read gate above includes both statistics cases. A subsequent strict typing correction flattens internal Drizzle SQL projections before reconstructing the unchanged public counters; the final selected statistics/completion/upgrade gate passes15 assertions (`2026-10-22T00-57-54.851Z-functional.json`,24.071s). Final strict server TypeScript, scoped stats/fact lint and format pass. Independent read-only review found no further query defects. No compiled transport or browser claim is made before T083–T087.

US4 adapter draft validation: server build succeeds; strict server TypeScript, scoped API lint and CLI focused types/lint/format pass. CLI source-unit regression passes61 assertions. The first compiled read-view gate passed30/31 cases but exceeded the unchanged10s case limit in the three-process CLI agenda ordering/pagination scenario (`2026-10-22T01-04-36.806Z-functional.json`,174.487s runner,151.986s testfile); no incorrect domain-result assertion was reported. T083/T084 remain open while this compound harness is split into bounded independent cases/files with the same coverage and real processes.

The US4 compiled contract harness is now split into four entry files:7 common/parity/boundary cases,13 CLI paging cases,7 CLI metric cases and20 HTTP cases. Shared registrations install closure-local fresh harnesses; no case makes more than two CLI launches and no assertions or time budgets were removed. The former timeout scenario now passes as two independent ordering/pagination cases (`2026-10-22T01-10-14.121Z-functional.json`,31.106s wrapper). The refactor passes full server TypeScript, scoped lint and formatting. Existing API helper/security/render-policy contracts also pass20 assertions (`2026-10-22T01-08-46.662Z-functional.json`,11.022s). Drizzle migration metadata passes `npx drizzle-kit check`. The final47-case transport join is still required before the adapter gate closes.

US4 T083/T084 accepted: all47 real CLI/HTTP read-view contracts pass in the four-file joined gate (`2026-10-22T01-12-42.274Z-functional.json`,88.615s; no timeout/signal), including strict scopes/filters, grouped order, cursor binding/staleness, independent timestamp ranges, parity and unchanged domain snapshots. All61 source CLI parser/formatter tests pass (`2026-10-22T01-04-01.774Z-functional.json`,24.996s). Production server build, full strict server types, scoped adapter/test lint and formatting pass. No production query behavior was weakened to resolve the earlier compound-case timeout.

US4 T086 source gate passes: Priorities shares project-grouped server paging; Workload separates parent/ordinary/outcome metrics, validates precise local half-open ranges and retains successful snapshots on refresh failure. Seven range/URL units pass, including folds/gaps, equal/reversed bounds and millisecond/clear behavior. Owned lint/format and the joined full browser TypeScript check pass. Browser execution and App navigation wiring remain pending T087.

US4 T085 source gate passes: Agenda uses server buckets/as_of, shared per-project merged pagination, configured model/status task cards and actual emoji copying; cursor errors retain loaded rows and offer explicit first-page refresh. Structured shared filters retain URL state, reject invalid values, clear cursors on apply and show applied scope/archive/terminal state outside collapsed controls. Filter units pass11/11 (`2026-10-22T01-20-58.258Z-functional.json`,3.191s). Scoped lint/format, strict helper types and root joined browser TypeScript pass. T087 owns navigation/build/browser acceptance.

US4 T087 navigation wiring and the first eight Chromium/WebKit read-view journeys pass (`2026-10-22T01-44-10.227Z-browser.json`,105.426s). The initial completed UI exceeded the unchanged exact JavaScript gate:151807 gzip-level9 bytes, then151385 after shared rendering controls. Standard Terser variants were measured and rejected because they increased output; the original OXC configuration remains. The shared schema/consumer layer now uses the public `zod/mini` API from the same pinned Zod version. Every existing constraint is retained through functional composition, including safe integers, numeric/length bounds, trim/pipe ordering, defaults, strict objects, custom checks and lossless descriptor-based JSON validation. Error normalization recognizes public `core.$ZodError`; category schemas are exported explicitly rather than reaching through array internals. Six independent classic/Mini equivalence cases protect boundary semantics. Full strict source/web typecheck and the production build pass. Emitted `assets/index-DghUDL4N.js` is472612 raw/136113 gzip-level9 bytes on Node24.22.0/zlib1.3.2.1-motley-285e94b. Full functional/lint and post-conversion browser regression remain pending; this size result alone does not close T087.

T087 regression follow-up: the first joined functional run (`2026-10-22T01-49-36.835Z-functional.json`,180.947s) and isolated rerun (`2026-10-22T02-01-22.879Z-functional.json`,181.290s) both hit the unchanged180s job limit. Compound replay/settings CLI cases were split into bounded cases without dropping protocol assertions; a supervised four-process startup also missed its existing8s fixture readiness deadline under parallel load. No case/job/production deadline was increased. Vitest's supported SSR dependency optimizer now bundles only the real Zod Mini/Temporal/Drizzle JavaScript dependencies, leaving native better-sqlite3 external. A focused nine-file144-case schema/read/EXPLAIN gate passes (`2026-10-22T02-08-50.031Z-functional.json`,33.022s). Fixtures now start the actual compiled API helper on first HTTP data access, rather than also starting an unused child in CLI-only cases; setup-only US2/recurrence seeding uses the same production core commands with unchanged human-web/Date.now attribution. Actual CLI and HTTP operations under assertion remain intact. The complete rerun PASSES all1404 cases/90 files (`2026-10-22T02-11-41.603Z-functional.json`,145.137s), including all47 read-view contracts,36 inventory/replay cases,39 recurrence/settings contracts, completion upgrade tests, and real EXPLAIN/query-purity checks.

The first post-Mini whole browser run passes107/108 in333.657s (`2026-10-22T01-53-33.584Z-browser.json`). Its single WebKit archive test read the task immediately after clicking restore, before the asynchronous restore response completed. The fixture now awaits the actual POST response and asserts200 before checking the stored resource; Chromium and WebKit both pass (`2026-10-22T02-00-23.585Z-browser.json`,16.498s). Original failure screenshots/video/trace are retained under `artifacts/red/2026-10-22T01-53-33-browser/`. All eight US4 browser cases pass in that whole run. A single all-green full browser release run remains required at T107; the focused rerun is not represented as such a run.

Full architectural lint passes after the schema migration. Its recursive local dependency scans now reuse TypeScript resolution and parsed-source results, refreshed by nanosecond mtime/size; authored paths always re-resolve so new/deleted files cannot hide an edge. Import-x avoids third-party internal graphs while the independent architecture rule still checks every local runtime/type edge. Manual actual-rule checks reject runtime cycles, type-only cycles, transitive browser-to-SQLite barrels, newly created backedges and edited cached backedges, and accept a safe schema. Full lint with caching passes in36.33s (versus244.62s with external graphs excluded but uncached local scanning); the final authored-path change additionally passes same-process invalidation probes. No architectural rule was disabled.

T087 closes with23 independent-process contention cases/5 files passing48.014s (`2026-10-22T02-14-49.058Z-contention.json`), full1404-case functional acceptance, all US4 browser/read-plan/transport cases, full source/web types, whole architectural lint, final scoped changed-file lint, whole formatting check and136113-byte exact JavaScript gate. Full browser release acceptance remains explicitly T107-owned as described above. US6 tests may now begin; no offline/recovery success is implied by this checkpoint.

US6 tests-first entry gate T088–T091 is authored before cache/recovery implementation. There are7 offline and4 mobile journeys (22 engine cases),3 recovery journeys (6 engine cases),34 real compiled CLI/HTTP recovery contracts,10 backup/restore source cases,13 private-process crash/publication cases,3 independent-holder restore contention cases, and2 diagnostic Unicode/tuple ordering regressions. The latter isolate scalar ordering where UTF-16 ordering differs, null ordering and duplicate suppression. Full strict source/web TypeScript and owned lint/format pass; browser/source/contention discovery succeeds. No missing future recovery module/helper is counted as behavioral RED, and no unexecuted source/crash test is claimed passing.

Actual recovery RED: successful migrated supervisor metadata200 precedes a valid backup POST returning404 where201 is required (`2026-10-22T02-22-48.902Z-functional.json`,3.798s). Actual offline RED: a real online task/source/safe-render control passes, then a cold offline reload cannot show the fetched task heading (`2026-10-22T02-29-02.483Z-browser.json`,20.403s). Its trace/video/context are retained under `artifacts/red/2026-10-22T02-29-02-browser/`. These are feature-result assertions, not missing imports, binaries, or a raised timeout. Later complete UI/core/crash acceptance remains T102-owned. The test-only recovery driver will compile the real core and lock entry into a separate artifacts directory, never rebuilding server dist while a compiled process is running; its private callback/IPC barriers do not add public failpoint flags or environment controls.

T094 first source checkpoint passes9 assertions across backup and Unicode conflict tests
(`2026-10-22T02-58-27.698Z-functional.json`,3.650s). It covers actual online SQLite backup
while an independent shared-lock writer commits, external exact receipts, epoch-before-replay,
settings changes after original success, changed actor/payload conflicts, inventory-signed
paging, same-owner task marker collisions, and byte-identical managed storage after list and
validation. An earlier run passed8/9 and exposed a partial strict test parser that rejected the
valid response's meta field (`2026-10-22T02-57-54.997Z-functional.json`); the fixture now uses
the complete public backup-envelope schema. Production behavior was unchanged for that fix.
An isolated native experiment also demonstrated that a WAL-header backup creates WAL/SHM
sidecars on readonly open. Completed private snapshots now switch to DELETE journal mode
before fsync/checksum/publication, keeping managed validation self-contained and read-only.
Negative artifact-validation coverage and joined US6 acceptance remain pending.

T092–T094 close their implementation checkpoint: nine cache/persistence/reconnect cases pass
(including late old epochs, retained successful snapshots, no mutation persistence and both
success/failure A→offline→B races). The production injectManifest build passes with three
precache entries; exact all-JavaScript gzip9 is140457 bytes (139671 application +786 SW),
below150000. The joined backup/negative artifact/Unicode gate passes15 cases/3 files
(`2026-10-22T03-02-34.615Z-functional.json`,12.793s); this includes checksum and metadata
corruption, unsupported manifest schema, symlink refusal, and empty uninitialized reads
without filesystem creation. Full `npm run typecheck` passes for server, browser and isolated
WebWorker projects; owned lint/format pass. No complete offline UI/browser or restore
acceptance is implied: global mutation boundaries and recovery publication remain later tasks.

T095 preparation/staging passes8 real SQLite cases (`2026-10-22T03-14-59.012Z-functional.json`,
7.031s): closed staged generation without live replacement, pre-write exact-scope refusal,
actual exclusive descriptor proof, malformed current audit refusal preserving database bytes
and managed inventory, raw JSON history/receipt preservation, live reservation rows and
nullable completion facts, cursor secret retention, all-scope exact-confirmation audits,
full same-policy hostile HTML rebuilding across pages and transaction rollback on a late
render failure. Current and backup audit semantics now use the existing public history
validator before recovery writes; malformed backup confirmation with recomputed checksum
is rejected in the7-case negative backup gate (`2026-10-22T03-16-39.805Z-functional.json`,
4.959s). Full strict server/web/SW types and scoped recovery lint/format pass. Atomic
publication, crash recovery and live maintenance are not yet implemented or accepted.

T096 atomic publication/recovery passes37 joined SQLite core assertions/7 files
(`2026-10-22T03-37-10.877Z-functional.json`,6.935s),19 actual-process crash/boundary
assertions/2 files (`2026-10-22T03-47-38.402Z-functional.json`,33.818s), and3 independent
holder contention cases (`2026-10-22T03-41-35.044Z-contention.json`,7.014s). Barriers cover
stage/manifest sync, atomic replacement, directory sync, verified reopen, terminal receipt
replay, and repeated failure during rollback. A live-path watcher observes no missing database.
Malformed phase/old-copy metadata refuse safely; issued success retains its original finished_at.
A genuine boundary RED (`2026-10-22T03-44-55.121Z-functional.json`,5/6 passing) found that
readonly SQLite inspection could create SHM before refusing an unexpected nonempty WAL.
Recovery now refuses that WAL before opening current SQLite, preserving the entire artifact
inventory. No WAL is deleted or quarantined. Earlier module capability-parser, compiled private
driver migration/ESM layout, and partial strict error-parser failures were harness prerequisite
failures; they are not claimed as domain RED. The final driver copies production migrations
and uses production ESM shims in a separate UUID artifacts directory. Full server/web/SW
strict types and scoped recovery lint/format pass. Live maintenance/adapters remain T097–T102.

T092 follow-up: a real cache regression first passed6/7 cases and failed persistence of current
read envelopes containing historical audit/backup epochs. Epoch ownership now reads only fetched
success-envelope metadata and stops before resource data, preserving old facts and envelope-shaped
user JSON unchanged. Mixed fetched envelopes remain rejected. All10 cache/reconnect units and
scoped lint/format plus strict server/web types pass; this does not imply offline browser acceptance.

T097 closes with57 joined assertions/12 files, including actual compiled supervisor/helper
and independent shared-lock maintenance (`2026-10-22T04-07-42.438Z-functional.json`,14.502s).
The stable HTTP proxy closes admission synchronously, drains accepted work, stops discovery
and workers, releases data-helper handles, and admits the next generation only after exclusive
publication/recovery and verified startup. The private Unix channel uses real lifetime flock,
0700 directory/0600 socket, strict bounded JSONL, fixed CLI attribution and no inherited DB FD.
The one-shot helper validates correlated IPC and waits for clean child exit before returning.
Status services read external receipts without SQLite; public endpoint registration is T099.
The compiled scenario holds an unrelated shared descriptor, observes ordinary HTTP503 with
external status still readable, releases it, and checks new-epoch HTTP200, unchanged lock inode,
restored rows and exact CLI audit attribution. Rejected confirmation resumes normal access even
while an unrelated shared connection remains open. Existing intentional-close, unexpected death,
worker attribution and shutdown behavior all remain green.

The old compiled generation first failed the real private CLI coordination assertion
(`2026-10-22T04-03-47.683Z-functional.json`,7.985s). A source RED also caught a delayed paused-worker
failure being reported after resume (`2026-10-22T04-03-11.727Z-functional.json`,2/3 passing);
worker generation identity now rejects stale callbacks. Additional startup coverage prevents
an already-ready worker dying during another worker's startup from opening admission. Review
also removed unnecessary exclusive recovery after a definitely rejected acceptance: after actual
child drain, external recovery records decide whether exclusive recovery is needed. Full strict
server/web/SW types, owned lint/format and production server build pass. T098–T102 transport/UI
integration remains pending; no complete US6 or release acceptance is implied.

T098/T099 implement five compiled backup commands (including documented --no-wait), managed
HTTP list/create/validation, restore202 acceptance and both DB-free external status lookups.
A detached standalone owner acknowledges only a durable job, closes its shared connection,
retains the supervisor mutex and completes/recoveries accepted work after CLI disconnect.
No arbitrary HTTP path/actor or public failpoint is accepted. All six initial standalone
cases pass in the first joined transport run; list/validation are subsequently split into
seven one/two-launch cases with unchanged DB-byte and managed-inventory purity assertions.

The first joined gate passes43/51 (`2026-10-22T04-16-35.435Z-functional.json`,126.016s).
Its eight failures exposed private plain Error normalization losing six CLI domain codes,
a valid-test CLI scope duplicated in JSON, and terminal job status racing HTTP generation
startup. Validated private failures now rebuild DomainError without widening native error
normalization; four real-socket regressions fail before this fix
(`2026-10-22T04-20-10.126Z-functional.json`) and all ten socket cases pass afterward
(`2026-10-22T04-20-49.160Z-functional.json`,7.691s). Own-job terminal HTTP status awaits its
bounded generation reopen while queued/running status remains immediately readable without
SQLite. Valid CLI validation now uses scope flags only; the current-only and backup-only
union scenarios are independent bounded cases, preserving all original assertions.
All11 actual CLI restore/status cases pass (`2026-10-22T04-25-53.560Z-functional.json`,42.580s),
and all four affected opaque-create/union cases pass
(`2026-10-22T04-27-38.994Z-functional.json`,15.659s). The file now contains35 contracts.

A subsequent multi-file run hits the unchanged180s job limit under concurrent host load
(`2026-10-22T04-22-10.617Z-functional.json`,180.490s). The next focused32-case run passes29
and has three supervisor fixture deadline failures
(`2026-10-22T04-33-43.885Z-functional.json`,42.990s). Fixture preparation now has its own
bounded beforeEach/afterEach lifetime, and maintenance-listener polling uses the existing8s
startup bound instead of an inconsistent2s bound. All three actual compiled scenarios pass
(`2026-10-22T04-36-08.343Z-functional.json`,21.319s). No case/job/production deadline increased;
all owned descendants were drained. These composed checks do not claim one all-green full
functional release run: that remains required at T107.

A narrow acceptance fast path reuses a healthy generation only for seven typed, proven
pre-publication domain rejections. Malformed local replies, validation/idempotency/operational
errors, failed resume and unknown outcomes retain drain/inspection/exclusive recovery;22
acceptance/generation units pass (`2026-10-22T04-30-31.797Z-functional.json`,6.655s).
An actual maximum-size private Unix regression first rejects a valid1MiB public mutation
because of wrapper overhead, then passes with bounded4096-byte private overhead and an
independent unchanged public-body cap; all seven focused socket cases, types/lint/format pass.
Runtime obtains that constant through its core port. Source types/owned lint/format and the
production server build pass. Global offline UI, maintenance-safe browser progress and final
all-suite acceptance remain T100–T107-owned.

## T100–T101 source checkpoint

Manual backup cards, exact union review, persisted user-text confirmation with original
epoch/settings/config tokens, maintenance-safe job lookup and global mutation guards are
implemented. Cached ordinary GET responses during maintenance retain their original
metadata and saved time; dedicated job lookups remain live and epoch-neutral. Unknown
mutations retain their frozen proposal for explicit retry/status recovery.

The four focused cache/readiness/backup-operation files pass29 tests in7.135s, exit0,
`artifacts/checks/2026-10-22T04-53-59.800Z-functional.json`. The confirmation base regression
passes1 case in6.157s, exit0, `artifacts/checks/2026-10-22T04-56-48.692Z-functional.json`.
Root server TypeScript passed; the joined web compilation first found an exact-optional
field mismatch in the new base matcher. After correction the pinned web TypeScript and
service-worker TypeScript pass, together with scoped ESLint and Prettier. These are source
checks; application navigation and actual production browser journeys remain T102 work.

## T102 integration regressions and fixture corrections

The initial28-case production browser run passed13 and failed15 in406.089s, exit1,
`artifacts/checks/2026-10-22T05-02-48.848Z-browser.json`. Six failures exposed24px summary
targets; the shared CSS now requires44px. Eight failures came from an authored fixture
reading nonexistent IndexedDB store `drafts` instead of production `draft-records`; the
fixture was corrected without weakening persistence assertions. The remaining WebKit
acceptance polling race motivated a real server-response barrier within the unchanged
30s case budget. Full traces remain under `artifacts/browser/T102-first/`.

Two added Chromium regressions fail on the old production bundle after successful fixture
setup: an open transition consent remains enabled offline, and a real restore/cache refresh
unmounts an open dirty project form. Both actual behavior REDs are in
`artifacts/checks/2026-10-22T05-10-02.707Z-browser.json` (34.677s, exit1); traces under
`artifacts/browser/T102-extra-red/`, log `artifacts/logs/T102-new-ui-red.log`.
The fixes propagate availability into the consent dialog and preserve the project editor
while refreshing epoch-scoped data, retaining original draft tokens and requiring explicit
current-version review before another save.

The subsequent32-case run passed21 and failed11 in239.924s, exit1,
`artifacts/checks/2026-10-22T05-11-48.385Z-browser.json`; full log
`artifacts/logs/T102-browser-fixed.log`, traces `artifacts/browser/T102-second/`. Remaining
fixture issues include the edit-specific save label, a non-invoked string callback used to
mark a DOM node, opposing Playwright color flags contaminating a real CLI stderr stream,
and WebKit service-worker requests bypassing page.route response-loss injection. The
geometry inventory is split into independent read/operation cases retaining every original
viewport and control assertion; case/job budgets stay30s/600s. These failed runs are not
whole-story acceptance.

After the UI fixes, production build and exact gzip accounting pass at148455 bytes including
service worker (`artifacts/logs/T102-build-fixed.log`, `artifacts/logs/T102-bundle-fixed.log`).
Source TypeScript, scoped lint and formatting pass. Functional workers are capped at4 and
normal browser workers at2 (CI1) to fit the four-core measurement profile; no check or
deadline is removed or increased. Complete functional/browser/recovery acceptance remains
pending the corresponding successful run below.

## T102 accepted integration checkpoint

The complete functional command passes all **1609 cases in117 files**, exit0,174.639s
inside the unchanged180s job/10s case bounds:
`artifacts/checks/2026-10-22T05-16-50.113Z-functional.json`, full output
`artifacts/logs/T102-functional-full.log`. This includes every recovery contract, actual
compiled standalone/default-wait/no-wait owner behavior, crash/boundary preparation and
publication tests, runtime/control/helper lifecycle cases, and the43-command/42-route
inventory with zero pending command rows.

The complete independent-process contention command passes **26 cases in6 files**, exit0,
34.974s: `artifacts/checks/2026-10-22T05-19-55.553Z-contention.json`, log
`artifacts/logs/T102-contention-full.log`. Actual file/SQLite lifetime locking and exclusive
restore ownership remain exercised rather than simulated by sequential calls.

The third US6 browser run passed59/60, exit1,169.191s
(`2026-10-22T05-21-06.372Z-browser.json`, `artifacts/logs/T102-browser-third.log`). Its
remaining WebKit overflow is a real nested grid-fieldset legend resize defect at320px,
not an accepted failure. Focused diagnostic failures and CSS trials are retained under
`artifacts/browser/T102-overflow*` and `artifacts/logs/T102-webkit-*.log`. Percentage
limits alone did not resolve it; normal block flow for fieldset stacks with explicit
spacing did. No overflow clipping or assertion removal is used. The corrected focused
WebKit case passes in16.193s (`2026-10-22T05-29-10.953Z-browser.json`).

The final complete US6/mobile/offline/recovery selection passes **all60 Chromium/WebKit
cases**, exit0,319.705s, within the same600s job/30s case bounds:
`artifacts/checks/2026-10-22T05-29-27.433Z-browser.json`, full log
`artifacts/logs/T102-browser-final.log`. The60 cases retain every original three-viewport
assertion while separating independent screen journeys. Both engines prove safe cold
offline reopening without artificial expiry, cache quota/eviction/missing state, every
mutation family disabled, dirty/uncertain proposal persistence, exact retry after real
committed response loss, real maintenance job lookup, epoch reconciliation, mounted project
editor retention, consent blocking and permanent-marker refusal.

Strict server/test and web/service-worker TypeScript, scoped lint/format and production
build pass. Final all-JavaScript gzip accounting is **148457 bytes**, including SW, below
150000 (`artifacts/logs/T102-build-final.log`, `artifacts/logs/T102-bundle-final.log`).
All six stories are implemented; the full release browser run, hardened accounting,
benchmark report, clean-install and final release gate remain T103–T107 work.

## T103 hardened JavaScript accounting

All36 focused accounting/filesystem/CLI cases pass in6.147s, exit0:
`artifacts/checks/2026-10-22T05-40-46.175Z-functional.json`. The production checker and
boundary tests use the same exported strict budget decision:149999 passes;150000 and
150001 fail. Nested lazy/SW/precache and alternate-case .js/.mjs/.cjs are independently
gzipped at level9, source maps are excluded, and server-looking JavaScript inside browser
output is still counted. Canonical regular roots/directories/files, O_NOFOLLOW reads and
strict unique inventory paths reject aliases, symlinks, FIFOs, missing/extra assets, invalid
UTF-8/JSON and native binaries. A real oversized CLI fixture exits nonzero with the measured
report. Scoped types/lint/format pass. The hardened checker measures the real current
production web/dist at148457 gzip bytes including service worker, exit0.

Release build entries are now explicit and mandatory; a missing required production helper
fails the build instead of disappearing through the bootstrap existsSync filter. The eight
entries cover CLI/API/data helper/migration/lock wrapper/lock module/restore helper/recovery
owner; worker run is a compiled CLI command, not a nonexistent standalone worker entry.
The next complete production build remains part of T107 verification.
