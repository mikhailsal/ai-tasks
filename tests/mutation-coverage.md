# Mutation verification ledger

T007 authors the shared kernel scenarios in
[`integration/mutation-protocol.test.ts`](integration/mutation-protocol.test.ts), using a
temporary file database, production migrations, real transaction handlers, and an injected
clock. T017 executed all 27 kernel scenarios successfully. The two real-SQLite
[`integration/audit-batch.test.ts`](integration/audit-batch.test.ts) cases also pass:
5,000 audit events commit in parameter-bounded statements within one transaction, and a
late insert failure rolls everything back. T021 integrated these checks with the compiled adapters and production browser shell;
all 217 functional, six lifetime contention, and ten browser cases passed. No story command is verified by a synthetic kernel operation.

The governing applicability rationale is the
[plan verification matrix](../specs/001-ai-task-manager/plan.md#constitution-v300-recheck-and-verification-matrix)
and the [mandatory task matrix](../specs/001-ai-task-manager/tasks.md). Add operation-specific
N/A reasons to that plan before dependent implementation; this ledger does not grant exceptions.

## Shared kernel scenarios

| Obligation                 | Authored observable check                                                                                                                         | Execution        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Atomic success             | Changed priority/entity revision/time, one durable audit and receipt, increased read revision, success IDs/epoch/time                             | Passed T017/T021 |
| Audit semantics            | Original entity/actor/scope/time and semantic/confirmation snapshots persist after config changes                                                 | Passed T017/T021 |
| Epoch before replay        | Save receipt, change current epoch, reject original exact request without any writes                                                              | Passed T017/T021 |
| Replay before stale checks | Save success, advance clock/config/settings/entity versions, return exact original envelope without handler execution or writes                   | Passed T017/T021 |
| Canonical fingerprints     | Reordered top-level and nested object keys replay; changed array order conflicts                                                                  | Passed T017/T021 |
| Changed request conflicts  | Same operation ID with changed actor, scope, operation, payload, or original preconditions rejects atomically                                     | Passed T017/T021 |
| Revision guards            | Stale entity/config/settings preconditions reject before the handler and preserve all durable state                                               | Passed T017/T021 |
| Scope and ownership        | Empty/missing project, absent target, and another project's task reject before any writes                                                         | Passed T017/T021 |
| Injected time and actor    | Fixed clock drives result/audit/update timestamps; worker uses `ai-cli:alpha` and `recurrence-worker` origin                                      | Passed T017/T021 |
| Handler rollback           | State and reservation writes followed by an injected handler error leave no state/revision/audit/receipt changes                                  | Passed T017/T021 |
| Persistence rollback       | Real SQLite insertion-abort triggers at audit and receipt stages undo state/read revision and any earlier audit; later valid write still succeeds | Passed T017/T021 |

These tests exercise one connection synchronously. They make no contention claim. Actual
overlapping independent-process writers and transient/exhausted lock behavior belong to
T049; shared/exclusive connection-lifetime locking belongs to T008 and restore locking to
T090. A synthetic kernel operation also does not substitute for input/domain validation,
confirmation, reservation, graph, or lifecycle checks in each command's owning suite.

## Command owners and coverage

For every domain mutation below, the owning suites must record committed state plus audit
and receipt, applicable input rejection, explicit scope/ownership, stale epoch/entity/config/
settings preconditions, exact replay versus changed request conflict, and atomic rollback.
Settings and entity guards apply when the operation uses those revisions under the common
contract. Audit must retain historical meanings and actual confirmation text where required.
US1–US5 pass their owning checkpoints. The T102 complete functional gate passes all
1609 tests, including the recovery contracts and the explicit inventory of 43 ready CLI
commands and 42 HTTP routes, with zero pending command rows. Operational backup/restore
cases use their real managed snapshot/job fixtures rather than generic placeholder IDs.
Authoring shared kernel tests does not close any domain row. Historical checkpoint notes
below retain their earlier pending states; current recovery/browser evidence is recorded
in the T102 checkpoint.

| Command family                                                              | Owning tests/tasks                                                                                                                                                                                                   | Required distinctions or justified applicability                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Project create                                                              | `integration/ordinary-work.test.ts`, `contracts/ordinary-work.test.ts`; T022/T024/T035                                                                                                                               | Default/supplied/invalid config, explicit new slug/uniqueness, reservations and rollback. Existing-target ownership/revision/config checks are N/A because the target does not exist; plan “New project” row.                                                                                                                                                                                                |
| Project edit/archive/restore                                                | Same US1 suites, extended recurrence suites; T022/T024/T035/T060–T062/T077                                                                                                                                           | Project revision plus config; complete affected child revisions, immutable slug/markers; US5 adds recurring retirement/catch-up and restored-child semantics.                                                                                                                                                                                                                                                |
| Task create/edit/transition/archive/restore                                 | `integration/ordinary-work.test.ts`, `integration/emoji.test.ts`, US1 contracts/browser; T022–T024/T035                                                                                                              | New task has no prior task revision; current config still required. Existing tasks require ownership and revision; confirmation/emoji return behavior and archived read-only rules apply. Recurring variants remain US5-owned.                                                                                                                                                                               |
| Configuration migrate                                                       | `integration/configuration.test.ts`, `contracts/configuration-dependencies.test.ts`; T036/T038/T047, recurring extensions T060–T062/T077                                                                             | Complete affected revision/mapping set, projected dependencies/emoji, old semantic snapshots and settings guard when timezone-sensitive. Preview is a query.                                                                                                                                                                                                                                                 |
| Dependency add/remove                                                       | `integration/dependencies.test.ts`, `contention/dependency-cycle.test.ts`, configuration/dependency contracts; T037/T038/T047                                                                                        | Source task ownership/revision plus independently validated target scope, advanced-state guards, cycle race and no automatic status change.                                                                                                                                                                                                                                                                  |
| Recurring create/configure/control/restore                                  | Recurrence integration/contracts/browser suites; T060–T062/T077                                                                                                                                                      | Parent/config/settings revisions, active intervals, unique generations, retirement/catch-up, confirmations and fixed clock boundaries.                                                                                                                                                                                                                                                                       |
| Occurrence complete/batch complete/cancel                                   | Recurrence integration/contracts/browser suites; T060–T062/T077                                                                                                                                                      | Parent and every selected occurrence revision, whole-batch ownership/rollback, actual/recorded/miss snapshots and cancellation reason/eligibility.                                                                                                                                                                                                                                                           |
| Explicit tick and scheduled worker tick                                     | Recurrence integration and actual tick race suites; T060–T062/T077                                                                                                                                                   | Both are mutations with receipts/audit, parent/config/settings/epoch checks, deterministic injected clock and unique generation identity. Interactive confirmation is N/A for deterministic scheduled processing; plan “Automatic recurrence” row.                                                                                                                                                           |
| Global settings/timezone change                                             | Recurrence/settings integration/contracts/browser; T060–T062/T077                                                                                                                                                    | Explicit attribution project, settings/config/epoch guards and transactional validation of affected parents (no caller affected-task revision set), preserved instants and future-generation semantics.                                                                                                                                                                                                      |
| Backup create                                                               | `integration/backup.test.ts`, `integration/backup-validation.test.ts`, `contracts/recovery.test.ts`, `contracts/standalone-recovery-cli.test.ts`; T089/T091/T102                                                     | Passed real online snapshots under a writer, opaque IDs, checksum/schema/integrity, fixed attribution, epoch-before-replay, exact external receipt replay and changed-request rejection, stale settings/config/epoch and archived attribution. Domain success audit/database receipts/domain rollback/task ownership remain N/A for this operational read-only snapshot; plan “Backup creation” row.         |
| Global restore                                                              | `integration/restore{,-prepare,-stage,-crash}.test.ts`, `integration/recovery-boundaries.test.ts`, `integration/recovery-supervision.test.ts`, `contention/restore-lock.test.ts`, recovery contracts; T089–T091/T102 | Passed exact live/backup union with nullable absent-live revisions; consent/settings/config/epoch guards; byte-preserved immutable audit and permanent reservation union, conflicts before publication, new epoch, DB-free status by both IDs, stage/crash finish/rollback and actual exclusive locking. Ordinary task edges and task-specific mutation revisions remain N/A; plan “Global restoration” row. |
| Read/config-preview/description-preview/history/backup-list/validate/status | Respective story suites; T022/T024/T036/T038/T048/T050/T078/T079/T089/T091                                                                                                                                           | Prove unchanged domain state/audit/receipts; successful mutation audit/receipts/write rollback are N/A to reads under the plan query/history or backup rows. Preview transport-origin requirements still apply.                                                                                                                                                                                              |

T035, T047, T077, T087, and T102 update the applicable rows with concrete scenarios and
execution evidence as each story reaches its checkpoint. T048 owns the complete CLI/HTTP
command inventory; T106 reconciles every command against that inventory and removes all
pending rows before release. Do not replace pending rows with silent skips or treat a
missing import as regression-first evidence.

Rendering-policy rebuilds are operational derived-cache maintenance, with applicability
recorded in the [plan verification matrix](../specs/001-ai-task-manager/plan.md#constitution-v300-recheck-and-verification-matrix).
T023/T026 must verify atomic HTML/policy refresh from unchanged task/occurrence source,
unchanged semantic revisions and immutable audit/receipts, and idempotence. They are never
implicit writes during a read or substitutes for audited description edits.

Project update/archive/restore use the immutable slug as both target and scope, as explained
in the plan's project-scope row. They still verify selected-project revisions/config,
immutable slug/payload-scope rejection, fixed CLI actor scope, changed-scope replay conflict,
and complete child ownership/revisions; there is no separate project target UUID in those
public commands. Task and occurrence target ownership checks remain mandatory.

## US1 core, adapter and browser evidence (T035 passed)

The final 554-case functional run at T035 executes every ordinary command through production
core functions, plus compiled CLI/Fastify parity. `integration/ordinary-work.test.ts`
parameterizes all eight existing-target/ordinary-create commands for durable state, audit
IDs/counts and receipt, exact replay, changed payload/base/actor/scope, stale epoch/config/
applicable entity revision, invalid input and late receipt-insert rollback. Its new-project
cases separately prove configuration/reservation/audit/receipt rollback and epoch ordering.

| Ordinary operation                           | Additional concrete evidence                                                                                                                                                                                            | Applicability/current scope                                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Project create                               | Default and supplied four models/custom initial status, invalid complete config rollback, uniqueness/fixed attribution, exact replay and changed scope                                                                  | Existing target revision/ownership N/A under plan; actual CLI/HTTP creation201 tested                                     |
| Project update                               | `ordinary-project-guards.test.ts`: fresh wrong CLI actor, immutable slug/ID/payload scope rejection, exact semantic name/priority before/after/config snapshot/receipt                                                  | Slug is scope and target; no separate target UUID by contract                                                             |
| Project archive/restore                      | Same guard suite: foreign/stale child rejected for both commands, semantic archive before/after; `project-reads.test.ts` includes individually archived children and preserves all children/reservations                | Ordinary members verified; recurring retirement/pause extensions remain US5                                               |
| Task create/update                           | Wrong scope/attribution, exact raw source/Unicode/nullable priority/deadline, human/agent whole-text and disjoint stale edits; `ordinary-emoji-lifecycle.test.ts` verifies actual create/edit collisions never fallback | New task entity revision N/A; existing task ownership/config/entity/epoch required                                        |
| Task transition                              | Every default edge, configured categories, exact user consent audit; `ordinary-prerequisites.test.ts` tests real cross-project stored blockers, archived completion and missing config fail-closed                      | Actual completed/cancelled release, reopen default/reject/replacement and atomic rollback verified by command emoji suite |
| Task archive/restore                         | Preserved workflow/source/status, archive read-only, scope/revisions/rollback; actual release and occupied restore return variants, audited marker replacement/current config/receipt                                   | Ordinary restore rejects transition confirmation; recurring variants remain US5                                           |
| Project/task/config/preset/description reads | Real query snapshots remain unchanged; explicit scope, normal pagination/as_of, filters/order and sanitized pure preview through CLI/HTTP                                                                               | Cursor adversarial integrity, audit browsing and later query families remain their owning stories                         |

`ordinary-project-guards.test.ts` and `ordinary-emoji-lifecycle.test.ts` inspect persisted
semantic changes, full current config snapshots and exact receipts. They verify capture of
current meanings; migration and browsing of historical meanings remain T047/T057.
T035 passes 42 browser cases across Chromium/WebKit, including pending-proposal reload,
exact uncertain retry, explicit conflict reconciliation, dirty archived draft restoration,
synchronous duplicate submission prevention, real clipboard copying and explicit marker
return choice after concurrent release. Browser artifact: 2026-10-21T20-20-46.899Z.
After the shared timestamp normalization fix, 554 functional cases across 30 files pass
in 93.534s (artifact 2026-10-21T20-26-57.800Z); original lowercase deadline spelling remains
part of immutable request identity. Six lifetime-lock contention cases also pass.
No recurring-family row is closed by this ordinary-only checkpoint.

Before T041/T042, the plan verification matrix records ordinary US2 guard applicability:
dependency add/remove have source task/config/epoch guards and separately validate the
prerequisite's explicit slug/ID/category inside the immediate transaction. No caller target
revision fields exist in that contract, and no schedule/timezone interpretation requires a
settings token. Configuration writes use config revision for both expected_revision and
expected_config_revision; an independent project entity token is not part of that command.
Schedule-dependent configuration migrations acquire the settings guard with US5.

US2 core and compiled evidence before the T047 browser gate:

- Configuration migration:61 production-command scenarios cover durable old/new semantic
  versions and exact receipts, complete active/archived revision sets, both config revision
  guards and epoch ordering, actor/scope identity, invalid/duplicate/missing mappings, late
  audit/receipt rollback, simultaneous projected completion, unchanged blocked dependents,
  same-category ID changes, and full projected marker collision/exchange behavior. Pure
  previews retain complete domain/graph/audit/receipt snapshots. Additional direct-preview
  size and own-key regressions pass.
- Dependency add/remove:20 core cases cover both mutation matrices, independent source and
  prerequisite ownership, unchanged target/state, semantic audit links, exact replay, stale
  source/config/epoch, malformed/archived-source/recurring/cardinality/cycle errors and late
  rollback. A real cycle diagnostic now exposes reason=cycle; UI advice distinguishes it
  from incomplete prerequisites.
- All54 compiled HTTP/CLI configuration/dependency contracts pass in the subsequent full
  pre-UI regression; its four failures are the new retry-helper RED tests and old command
  inventory, not these contract rows. Seven contention cases pass, including the actual
  opposing-edge process race (artifact2026-10-21T20-50-17.458Z).

These source/adapter results do not close US2 until its joined browser and regression
checkpoint passes. Recurring migration/lifecycle extensions retain their T069/T077 owner.

## US2 joined checkpoint (T047 passed)

The final whole regression passes732 functional cases/38 files (94.000s), all7 real
contention cases (6.680s), and66 production browser cases across Chromium/WebKit
(178.742s). Exact artifacts are in the T047 entry in [tests/README.md](README.md).
Migration and graph matrices above now pass through core and both compiled adapters.
The opposing-edge race retains one edge/receipt/audit and no cyclic outcome. Historical
configuration rows and saved semantic audit snapshots remain immutable after migration.
Browser checks cover all4 models, archived mapping members, actual confirmation text,
stale config/source review, commit-time marker races, local persistence recovery and
exact nested dependency replay after a lost response. The older ambiguous archive notice
assertion was made specific without changing behavior. No recurring lifecycle/migration
row or later history browser/query row is closed by this checkpoint.

## US3 joined checkpoint (T057 passed)

All797 functional cases/43 files,20 independent-process contention cases and76 production
Chromium/WebKit cases pass, with exact artifacts/durations in [tests/README.md](README.md).
History queries return immutable original before/after/config meanings and exact consent,
including absent live project/entity and old-epoch records, with no domain/audit/receipt
writes. Signed cursors bind context, epoch/read revision and original server as_of; malformed
or altered tokens cannot substitute caller time. Valid stale contexts explicitly refresh.

The command inventory covers43 application CLI commands/42 HTTP routes plus informational
forms. Twenty-four command rows are accepted;19 later-family rows are explicit pending
data with story owners, never skipped tests. Their acceptance is mandatory before release.
Compiled history through both adapters retains fixed actor/stream/status/time behavior and
query purity. Production/development browser delivery, exact scope links, safe failures
and origin/Host/body boundaries pass. Actual separate-process writes verify native5000ms
busy exhaustion/recovery, same-operation races, stale whole/disjoint descriptions/config
and marker exclusivity. Runtime readiness, unexpected helper death, intentional maintenance
closure and graceful drain preserve lifetime locks and do not create domain audit writes.
No recurrence or recovery operation is closed by this checkpoint.

## US5 tests-first wave (T058–T061)

Calendar/generation, occurrence-outcome and lifecycle matrices are authored against production migrations and real SQLite. Compiled recurring creation fails at a real assertion after successful metadata/epoch controls: CLI exits2 for a valid recurring payload while0 is required. T060 artifact `2026-10-21T22-04-58.901Z-functional.json`; adapter artifact `2026-10-21T22-09-51.777Z-functional.json` (6.042s). These are observed behavior failures, not missing-module or executable errors. Later lazy source calls, real process recurrence races and ten Chromium/WebKit journeys remain pending implementation; they are not claimed executed or passing. No completed story checkpoint is implied by authoring this wave.

US5 guard applicability is recorded before dependent task integration in the [plan verification matrix](../specs/001-ai-task-manager/plan.md): cancellation uses stored absolute windows without a settings guard; direct recurring lifecycle commands share recurrence-control settings guards; content-only recurring TaskPatch does not interpret schedules and rejects a user deadline. Global timezone updates use their contracted settings/config/epoch tokens without an invented affected-parent revision payload. These N/A choices do not waive ownership, entity/config/epoch, receipt, audit or rollback checks.

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

## US4 read-view evidence (T087)

The inventory contains38 ready command rows and5 explicit US6 pending rows. Agenda,
priorities and stats use the same core reads through compiled CLI and HTTP; all47
read-view contracts and36 generic inventory/replay cases pass in the1404-case functional
checkpoint (`2026-10-22T02-11-41.603Z-functional.json`,145.137s). Before/after snapshots
cover recurrence generations, intervals, occurrence states, ordinary completion facts,
audit, receipts and application state. Queries never tick/expire work, write history or
allocate mutation operation IDs. Read ownership/scopes, literal normalized filters,
project/model ordering, signed snapshot cursors and unchanged domain snapshots are checked.
Mutation-only confirmation/idempotency receipts are N/A to these pure GET/CLI read paths.

Actual prepared statements and bindings drive the five EXPLAIN/query-count cases in
`integration/query-plans.test.ts`; see `query-plans.md`. Parent rows are bounded in SQL,
configuration lookup does not grow with page size, and recurring effective deadlines use
the indexed pending/debt lookup. Internal ordinary completion recording has an additive
migration and conservative populated-upgrade coverage; it adds no public mutation input.

All eight Chromium/WebKit view journeys pass in the post-Mini whole browser run
(`2026-10-22T01-53-33.584Z-browser.json`): five calendar buckets, project/model context,
priority modes, server as_of across paging/browser clock changes, stale refresh, literal
search/reload, precise half-open statistics ranges and mobile layout. That whole run is
107/108 because an older archive test omitted waiting for the asynchronous restore POST;
the corrected response-wait scenario passes both engines separately
(`2026-10-22T02-00-23.585Z-browser.json`). This does not claim a fully green whole-browser
release gate; T107 still requires it. Offline/cache/recovery rows remain US6-owned.

## US6 tests-first evidence (T088–T091 authored)

A valid operational backup create currently returns404 after metadata200; see
`2026-10-22T02-22-48.902Z-functional.json` (3.798s). Online source/render succeeds before
cold-offline content fails at its actual cached-heading assertion; see
`2026-10-22T02-29-02.483Z-browser.json` (20.403s). All new source types and scoped lint
pass, and authored cases are discoverable. Recovery/cache implementation is still absent;
its future-module prerequisites, crash phases and complete browser journeys are not accepted
results yet. The operational tests keep domain audit/receipt N/A explicit for backup create,
require external receipts and both job lookup forms, and reserve restore-specific epoch,
exact affected-scope/revision, confirmation, audit/reservation union, exclusion and publication
checks. No new public no-wait or failpoint option is introduced by the fixtures.

## US6 joined checkpoint (T102 passed)

The complete functional gate passes1609/1609 cases in117 files (174.639s, exit0),
`artifacts/checks/2026-10-22T05-16-50.113Z-functional.json`. All43 command rows and42
HTTP routes are ready with no pending rows. The five recovery commands explicitly
delegate to named CLI/HTTP recovery contract cases; generic read preparation rejects
managed backup/job placeholders rather than sending invalid synthetic IDs.

Backup creation proves verified online snapshots during real writes, checksums/integrity/
supported schema, read-only validation, exact external receipt replay, fixed actors,
archived operational attribution and epoch-before-replay. Restore proves the exact live/
backup union with nullable absent-live claims, confirmation text and settings/config/epoch
guards, original audit-byte and reservation-owner preservation, pre-publication conflict
refusal, recovery copy and staged atomic publication, restart completion/rollback, rejected
old-epoch replay, DB-free status by both IDs, actual drain/exclusive flock and no inherited
descriptor deadlock. Domain state/audit/database receipts remain unchanged for operational
backup reads; task transition edges and task-specific revisions remain N/A to global restore.

All26 independent-process contention cases pass in34.974s, exit0
(`2026-10-22T05-19-55.553Z-contention.json`), including restore exclusion and online snapshot
concurrency. All60 US6 Chromium/WebKit mobile/offline/recovery cases pass in319.705s, exit0
(`2026-10-22T05-29-27.433Z-browser.json`). Every original viewport/control check is retained,
with separate bounded journeys for independent screens. Actual server commits precede
the browser response-loss fault; exact immutable retries and one receipt/audit are asserted.
New regressions first failed on the old production UI for offline consent and disappearing
project editors, then passed with original draft text/base tokens and no automatic write.

The ledger's earlier authored/pending notes are historical. This accepts US6 integration;
T106 reconciles final requirement coverage, and T107 still owns whole-product release evidence.

## T106 final coverage reconciliation

The [acceptance crosswalk](acceptance-coverage.md) maps all26 functional requirements,
11 verification obligations,13 success criteria, constitution I–VII and stack/privacy/
migration/governance obligations to concrete implementation and observable tests. It also
maps all11 UI operation families to production browser scenarios. The executable command
inventory remains43 ready CLI commands and42 HTTP routes with zero pending/target rows;
its five recovery rows retain named real operational transport scenarios instead of generic
placeholder backup/job IDs. No command-matrix behavior change was needed for this review.

Current applicability follows the approved plan: global settings requires
expected_settings_revision, attribution expected_config_revision and epoch; affected parents
are validated in the transaction, with no caller per-parent revision set. Pure reads/previews
assert no domain writes. Operational backup creation has external receipts without domain
success audit/database receipts; restore retains its stricter union/consent/epoch/history/
exclusive-publication coverage. These are documented N/A cases, not synthetic substitutes
for domain mutation tests. All earlier authored/pending statements above remain historical.

T106 is a coverage reconciliation, not a new whole-suite run. T107 still owns clean install,
current production migration/native smoke, full type/lint/format/build, functional/compiled
contracts, independent contention, whole Chromium/WebKit suites, exact bundle bytes, actual
benchmarks and executable quickstart evidence. A missing predecessor release remains N/A
for v1 only; future populated released-schema upgrades and rollback must be tested.

### T107 recovery contract scheduling refinement

The same35 recovery contract cases now run as15 CLI cases in
`tests/contracts/recovery-cli.test.ts`,15 HTTP cases in
`tests/contracts/recovery-http.test.ts`, and the five shared HTTP/union/maintenance cases
in `tests/contracts/recovery.test.ts`. Shared registrations are in
`tests/fixtures/recovery-registrations.ts`; each runnable entry installs its own
closure-local fresh harness through `tests/fixtures/recovery-registrations-context.ts`.
All original scenarios/assertions and per-case budgets remain intact. The command matrix
checks both actual entry registrations and the shared named scenarios; recovery delegation
continues to cover all five operations without placeholder backup/job identities. This is
a scheduling refinement after a timed-out whole run, not a claim that the rerun passed.
