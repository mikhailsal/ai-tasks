# Validation guide: Project-first mobile Kanban

## Current status

The user accepted sketch A and explicitly authorized implementation and a final commit. The real application now implements project-first navigation, swipeable ordinary/recurring boards, complete server-side search and deadline/priority filtering, shared database order/guarded stage transfer, direct task editing, contextual tag navigation and actual audit history. The first transfer required repairs after user review; the renewed convergence evidence below supersedes the initial check summary, with the same approved temporary bundle exception. Human acceptance of the real application remains separate.

Existing list-first prototype checks and all standalone sketch checks are historical evidence only. The reviewed standalone source is tracked at [design/sketch.html](design/sketch.html).

## Standalone design review

Open [sketch A](design/sketch.html), served in the current session at `http://192.168.1.203:3001/`. Select a project, open toolbar search, try a title (`мобильную`) or description-only term (`Safari`), inspect the stage label, open/back, clear, test no matches and cancel back to the same board column. Toggle “Обычные / Повторяющиеся”, select different stages in both, switch back and check retained positions. Search should only show the active kind. This sketch uses synthetic sample data and makes no application/database requests. Order and stage changes may persist in localStorage in this browser, independently per project/type; this does not demonstrate shared application persistence, which must be authoritative in the shared database. New sample tasks remain temporary. Hold a card’s grip to drag, move near a board edge for the neighboring stage, then release at the intended position. A short grip press opens equivalent move controls. Try a blocked completion and a confirmation-required completion. Filters disable dragging. Verify exact priority, exact local calendar day (tomorrow only), and exact status filters remain visible and removable. Blocker badges are explanatory only. Verify project title opens that project's editor and Back restores board state. Verify detail is directly editable with explicit Save/Cancel and a discoverable synthetic history section clearly distinguished from real audit history. Outside/backdrop press and Escape cancel pending dialog/filter edits and never apply or confirm.

## Acceptance journeys

1. Open projects, choose a project and reach its board directly; add using that project and its configured initial status.
2. In a custom six-stage project, swipe left/right through adjacent columns, including empty stages and two stages with the same category. Verify no wraparound and no task mutation from ordinary swiping; separately test long-press handle drag within/across columns, edge auto-advance and keyboard/menu equivalents.
3. Scroll a long column vertically, tap a card, return and preserve the selected stage/position. Transition a task with required consent and observe fresh board membership without duplicates/manual refresh.
4. Use keyboard/stage selectors, reduced motion, 320/390/430/1280 widths; document overflow remains absent while the board itself scrolls horizontally. Verify ≥44px targets and readable cards/menus/forms.
5. Page through a column without reclassifying its existing snapshot; show partial counts truthfully. Handle stale cursor/config changes and another client's edits without mislabeling stages.
6. Load some columns/detail online; reopen offline. Read cached columns, explain unfetched neighbors, disable every mutation, reconnect and retain dirty drafts/epoch protections.
7. Search the selected project across stages and unloaded pages by title/description. Verify correct scope/stage labels, clear/no matches/errors, detail/back query retention and board position restoration on cancel. Explain missing offline search snapshots rather than faking complete results.
8. At 320/390px use the visible ordinary/recurring switch without opening menus; check separate workflows, per-kind positions, correct search/create scope, recurring parent versus occurrence semantics and no mutation from switching.
9. Open filters next to search/add, apply high+today and verify conjunction, stage counts, active summary, reset and cancel-without-applying. Search uses those filters; kind switching restores them independently. Test matching tasks beyond initial pages and midnight/DST boundaries for today/from-tomorrow/next-three-days/null/recurring deadlines.
10. Reach all former project/configuration/recurring/overview/history/settings/backup operations in compact secondary navigation.

Use isolated production-migrated synthetic fixtures, never write verification data to the live database. Reproduce failing board tests first. Use actual directional touch gestures, not only programmatic scroll positions. Capture and inspect project-home/board/detail at 320/390px in Chromium and WebKit before further polish.

## Execution gates

Pinned Node 24.22.0 / npm 11.19.1; existing dependencies only. Run build-dependent jobs sequentially, with separate documented case/job budgets (browser 30s/case, 600s/job; functional/contention 180s/job).

```bash
npm run check:runtime
npm run build
npm run test:e2e -- tests/e2e/mobile-ux.spec.ts
npm run test:functional
npm run test:contention
npm run test:e2e
npm run typecheck
npm run lint
npm run format:check
npm run check:bundle-size
```

Keep emitted JS gzip strictly <170000 bytes including SW/lazy chunks under the explicit 2026-10-23 user-approved temporary exception in plan.md; the constitution baseline remains 150000. Do not change other budgets, weaken guards or bypass hooks. Deadline read-filter query-plan review is required; new indexes need measured justification. Existing transition guards remain authoritative; new order and transfer writes need parity/idempotency/optimistic-concurrency checks; broad backend/runtime benchmarking is unnecessary without additional scope. Record actual commands/exits/durations and reviewed screenshots after execution. Tests/agent review do not imply human acceptance.

## Standalone sketch checks (2026-10-23)

These checks validate the synthetic HTML sketch only, not application acceptance. `artifacts/mobile-ux/design/check-drag.mjs` checks pointer reorder/reload, cross-stage move/reload, project isolation, menu equivalent, dependency refusal, completion confirmation/cancel, filtered drag disablement and 320px document overflow in Chromium and WebKit. `check-touch-drag.mjs` uses Chromium touch input for long-press reorder, edge transfer, reload persistence, horizontal navigation without writes and independent vertical scrolling. Screenshots in the same directory support visual review. Shared-device persistence, real transition guards, concurrent conflicts and production DB migration remain planned checks.

Executed with pinned Node: `node artifacts/mobile-ux/design/check-drag.mjs` and `node artifacts/mobile-ux/design/check-touch-drag.mjs`, each exit 0. A separate Chromium check passed short-touch menu opening, storage-failure rollback, visible drag ghost and Escape cancellation.


The prototype owner implements only the synthetic sketch interactions described above. Application implementation is now explicitly authorized; the synthetic sketch remains a separate design reference. Its history sample must be labeled synthetic; real immutable audit coverage, including stage/order events, remains an application acceptance requirement. Exact deadline tag filtering means the displayed local calendar day, never a broad “from tomorrow” preset.

`node artifacts/mobile-ux/design/check-details.mjs` (pinned Node, exit 0) validates the new synthetic detail interactions in Chromium and WebKit: directly editable title/emoji/description, explicit save/cancel and retained draft, emoji/title alignment, visible sample history and full-history sheet, exact priority/day/status chip filters, project edit/back, outside dismissal of every dialog, filter/transition cancellation by backdrop and Escape, vector search and 320px overflow. The drag suites also passed after the card markup changed. New `*-inline-detail*.png` screenshots were visually inspected at 320/390px. No application/database persistence or real audit acceptance is claimed.

## Application validation (2026-10-23)

- Regression first: `board-red.log` records the former home/direct-edit failures. `deadline-red.log` records the absent deadline-filter behavior before implementation.
- Runtime: Node 24.22.0 / npm 11.19.1 / SQLite 3.53.4 (`runtime-final.log`, exit 0).
- Full typecheck and ESLint passed; final formatting passed (`format-final.log`). Subsequent source fixes receive focused checks and the final gates are rerun before acceptance.
- Focused server verification: 54/54 board/dependency/blocker/query-plan tests passed; deadline/transport contracts 5/5 passed. Full suites are tracked separately below.
- Initial browser pass: 19/24 passed (`board-focused-2.log`, exit 1). Observed 320px chip target and search accessible-name defects were corrected; reloading drag tests now wait for the handle to become enabled. A navigation journey was split into independent journeys without changing budgets or removing destinations.
- Real visual review: `node --import tsx artifacts/mobile-ux/review.ts` exited 0 (`polished-review-2.log`). Chromium and WebKit screenshots at 320/390px show no document overflow. The board retains a visible adjacent-column hint and compact toolbar. Task detail now has a compact description editor, collapsed parameters, visible actual history and fixed Save/Cancel actions. Screenshots were inspected; these are actual production UI reads against isolated fixtures, not the sketch.
- Restore-consent cancellation review found a delayed-persistence race. A deterministic gated-IndexedDB browser regression was added, and cancellation now invalidates pending submission before clearing consent. RED was not executed before the fix under host contention; `backup-cancel-review.json` records the source-path reproduction and this limitation. The deterministic pending-persistence regression passed in both Chromium and WebKit, including Escape, outside and explicit Cancel; see full browser logs.
- Live database backup: `data/pre-mobile-ux/20261022T234439Z.sqlite`. Production SQLite integrity check is `ok`, foreign-key check empty, 4 projects / 29 tasks. The system Python SQLite is older and is not the integrity authority for this database. No verification fixture writes touch the live database.
- Build succeeds; initial reviewed gzip report was 162556 bytes (`polished-bundle.log`, exit 1), exceeding the original 150000-byte limit. Safe chunk/JSX/minifier experiments did not meet the gate; no runtime dependencies were added. The user subsequently explicitly approved a temporary 170000-byte ceiling for 002; the exception, expiry and compensating checks are recorded in plan.md. Final report and boundary checks are required against that approved ceiling.

All evidence paths above are under ignored `artifacts/mobile-ux/`. Failed and resource-limited runs remain recorded and are not passing evidence. Build-dependent checks run sequentially with the existing budgets; lowering worker concurrency does not waive coverage. At most two browser jobs run together, each with one worker and its own isolated port (`AI_TASKS_TEST_BASE_URL=http://127.0.0.1:3038 AI_TASKS_PORT=3038`) so the live application remains separate. Never rebuild `dist/` or `web/dist/` during compiled CLI/browser suites: Fastify registers concrete static asset filenames at startup.

### Verification evidence after integration

| Command / evidence | Result | Duration |
| --- | --- | --- |
| Full functional shard 1/2, `--maxWorkers=2` (`functional-1.log`) | Exit 1: 754 passed, stale CLI-command-list expectation failed | 121.523s |
| Full functional shard 2/2 (`functional-2-default.log`) | Exit 1: 926 passed; two stale prior-schema test fixtures and one loaded-host timeout | 141.011s |
| Recheck all three affected files, `--maxWorkers=1` (`functional-corrections.log`) | Exit 0, 44/44 passed; all 1684 functional cases covered across full runs and corrective rerun | 63.797s |
| Full contention suite (`contention-final.log`) | Exit 0, 30/30 passed in 7 files, including real board-order races | 59.675s |
| Approved ceiling accounting tests (`bundle-accounting-approved.log`) | Exit 0, 36/36 passed; strict boundary/inventory/CLI negatives retained | 3.868s |
| `npm run build` (`final-build-2.log`) | Exit 0, production server+web+SW | See build log |
| `npm run check:bundle-size` (`bundle-approved.log`) | Exit 0, 162798 bytes gzip level 9; strict 170000 temporary ceiling approved by user | Not a timing gate |
| Actual board SQL plans (`board-query-plans.log` / `.json`) | Exit 0, 8 cases on 1000 tasks / 10000 occurrences / 2 projects / 5000 audits. Ten read statements for either 1 or 50 returned tasks; empty result uses 6. Project/status lookup, board-order PK and task/state/deadline occurrence indexes used. Scoped sorting uses a temporary B-tree; no occurrence full scan. | No new timing claim |
| Full typecheck/lint/format (`*-acceptance.log`) | Each exit 0 after the final UI behavior change. Approved budget documentation/checker receives an additional focused check. | Not recorded as suite timings |

The earlier two-worker shard 2 attempt hit its 180s job budget under host contention (`functional-2.log`, exit 124); it is not passing evidence. Existing case/job budgets were not raised. Full browser coverage is executed per configured browser/shard. The last three jobs use the existing isolated browser-server fixture copied to an ignored helper with only `npm run db:migrate` replaced by `node dist/migrate.js`; this avoids concurrent rebuilds of shared precompiled files and uses the same production migration/server code and test assertions.

Regression `drag-cancel-red.log` reproduced a real position POST after browser history activated a filter during a held drag. The release handler now rechecks availability; the full Chromium first shard passed this regression. `tag-context-red.log` reproduced dropped search context from a legacy priority tag; card filter links now carry only compatible q/priority/deadline/status dimensions, and replace the clicked dimension.


### Final browser and quality reconciliation

Chromium full shards covered all 101 cases: 52/54 and 46/47 initially passed; the three failed expectations were updated for the reviewed “Вся история” link, multiline keyboard End behavior, and direct project-board destination. All three passed the corrective run (`browser-chromium-corrections.log`, exit 0, 40.650s), preserving source, no-duplicate-write, origin and audit-scope assertions. New board search, pointer transfer/fresh-browser persistence, real touch navigation/drag, edit/history refresh and consent cancellation all passed.

WebKit first shard (`browser-webkit-1-isolated.log`) passed 53/54 in 544.575s, exit 1. One creation journey interacted with the still-mounted new-task form before navigation finished; the test now waits for the created task URL. Its separate rerun passed (`browser-webkit-named.log`, exit 0, 19.366s). The earlier first WebKit attempt was stopped after shared artifact directories collided (`browser-webkit-1.log`); it is not passing evidence. All subsequent concurrent browser runners use separate output directories.

New `project-board-offline.spec.ts` was added only after both full matrix partitions were collected, preserving partition membership. Chromium passed cached reload/new-tab reopen, honest unfetched-column state, disabled writes and unchanged real database (`board-offline-chromium.log`, exit 0, 27.679s).

The only engine-specific skip is Chromium CDP native touch input under WebKit. Chromium executes the actual native touch sequence; both engines execute real pointer reorder/edge transfer and fresh-browser persistence journeys. Physical iPhone hardware has not been tested.


WebKit also passed the new board-specific offline reload/reopening journey (`board-offline-webkit.log`, exit 0, 26.340s). No production change was needed for cached versus unfetched column handling: the application uses networkMode always with its existing persisted read snapshots, so the hypothetical paused-with-cache branch was not reachable in this journey.

The executable quickstart passed against a disposable production-migrated database (`executable-quickstart.log`, exit 0, 24.339s): CLI streams/UTF-8/exact receipts, HTTP parity/origin/revision refusals, backup/restore/audit union and recovery status/restart.


WebKit second shard passed 46 cases with one CDP-only native-touch skip (`browser-webkit-2.log`, exit 0, 487.743s). Combined full runs and documented corrective reruns cover all 1684 functional cases and all 203 passing browser cases (102 Chromium, 101 WebKit); the sole engine-specific skip is recorded above. All 30 contention cases passed. No failed or interrupted run is relabeled as passing; obsolete expectations and the creation-navigation race were rechecked explicitly.

Final quality checks ran after the last source/test additions, sequentially under the pinned runtime (`final-quality.json`):

| Command | Exit | Duration |
| --- | --- | --- |
| `npm run typecheck` | 0 | 69.847s |
| `npm run lint` | 0 | 112.458s |
| `npm run format:check` | 0 | 29.389s |
| `npm run check:runtime` | 0 | 0.553s |
| `npm run check:bundle-size` | 0 | 0.412s |

The production bundle contains 162798 individually gzipped JavaScript bytes including service worker, below the approved strict 170000 ceiling. Production migration preserved 4 projects and 29 tasks; all 29 have shared board-order rows, integrity is ok and foreign-key check empty. The current application is served at http://192.168.1.203:3000/; the synthetic sketch on port3001 remains only a design reference. The user explicitly requested a final local commit; no push is authorized.


## Convergence after the first application transfer

User review found actual defects despite the earlier completed checks. The accepted sketch was concrete enough to catch the main layout drift; earlier implementation review overvalued viewport/functional assertions and did not adequately compare the real screens with that sketch. Localhost also masked a secure-context-only API failure on ordinary LAN HTTP. The first acceptance evidence above remains historical; it does not establish human acceptance or cover these failures.

Phase 7 addresses the reported defects:

- Browser operation IDs retain native randomUUID on secure contexts and use native cryptographic random bytes on insecure HTTP; existing immutable proposals/receipt identities remain unchanged. No dependencies or weak randomness were added.
- Application controls keep plain hover styling. The project-search accessible label is visually hidden; its input, clear and cancel controls fit 320/390px. The short visible placeholder fits narrow phones, and the icon remains SVG.
- Move errors have a close control. Dismissing a message does not discard an uncertain proposal; explicit retry reuses exactly the same bytes. Storage failures still prevent unsafe writes.
- Task and project editors follow the accepted header/main-field/fixed-footer hierarchy. Ordinary text editing is primary; formatting, saved source/preview, technical metadata and configuration tools remain secondary. Exact saved/user-edited source and drafts are preserved.
- Secondary routes have visible contextual Back controls with a safe in-app fallback. Board/task/project editor headers provide their own return control. Active stage tabs follow horizontal navigation; sync and stage position share one compact footer. Date tags show relative days and overdue urgency from the cached server snapshot, preserving exact-day filters and exact timestamp titles. Filter AND/calendar explanations stay visible.
- Nested dialog Escape cancellation no longer bubbles into the parent action dialog. Connection state remains available inside the action dialog, including offline/error/update states; mutation guards and confirmations remain intact.

Before the first fix, `sketch-regressions-red.log` reproduced hover/search/move-error failures (4 failed), `editors-parity-red.log` reproduced task/project editor mismatch (2 failed), `back-red.log` reproduced the missing secondary Back control, and the HTTP UUID regression reproduced the missing API. The first focused final-layout run passed 13/14 Chromium and 12/14 WebKit; it exposed the nested Escape bug, plus WebKit service-worker routing bypassing the deliberately aborted network request. That error-injection suite now explicitly blocks service workers so its mocked transport failure is deterministic; real production offline/service-worker journeys remain separate and unchanged in meaning.

The full matrix initially exposed stale test entry points for newly secondary task actions/source views. Helpers and callers now use the same visible menu controls as a person. Existing exact-source, sanitizer, offline, confirmation, receipt and database-state assertions are retained. No failed run is considered passing evidence.

### Demonstration description cleanup

The Markdown template came from the demonstration seed I supplied. A hash-pinned recognizer matched the original seed definition and creation audit, required exact unchanged descriptions and rejected any later description edits. After a verified native SQLite backup, 28 editable demonstration descriptions were saved as readable plain text through guarded HTTP task updates. All 127 earlier audit records, non-target descriptions and board positions were verified unchanged; new changes have normal audit entries and receipts. The one archived task remains unchanged under the existing archive guard. No application startup cleanup or general user-content rewriting was added.

Evidence: ignored `artifacts/mobile-ux/cleanup-demo-descriptions-{dry-run,applied}.json`; verified backup and exact operation manifest under ignored `data/pre-demo-description-cleanup/`. Native SQLite integrity is ok, foreign-key violations are zero, and 4 projects/29 tasks/29 board-order rows remain.

### Renewed checks and visual review

Actual LAN HTTP screenshots are `artifacts/mobile-ux/convergence-*.png` and measurements are `convergence-review.json`: project home, board/search/task/project editor at 320/390px, filters and settings. The reviewed HTML sketch remains unchanged. Real data, configured initial stages, partial counts, real audit events and exact-date editing remain authoritative; synthetic sketch totals/events are never copied into application state. Physical phone hardware has not been tested.

Full browser jobs use the same ignored prebuilt-server helper documented above, with distinct ports/output directories and unchanged case/job budgets. One Chromium second-shard attempt was intentionally interrupted after host load rose while three browsers ran concurrently; its log is retained and is not passing evidence. Final checks/results are recorded below after completion.


### Final convergence results

| Check / evidence under `artifacts/mobile-ux/` | Result | Job duration |
| --- | --- | --- |
| UUID, immutable draft/proposal and strict bundle accounting (`convergence-functional-focused.log`) | Exit 0, 51/51 passed | 4.181s |
| Chromium full shard 1 (`convergence-full-chromium-1.log`) | Exit 1, 55/65 passed; stale secondary-menu/source helpers and hidden timestamp assumptions repaired and rechecked below | 354.419s |
| Chromium full shard 2 (`convergence-full-chromium-2-final.log`) | Exit 0, 52/52 passed | 290.270s |
| Chromium corrective journeys (`convergence-chromium-corrections.log`) | Exit 0, 14/14 passed; covers all ten first-shard failures, both added stage/deadline checks and actual insecure-HTTP move | 94.692s |
| WebKit full shard 1 (`convergence-full-webkit-1.log`) | Exit 1, 37/39 passed; two stale secondary-entry helpers repaired and rechecked | 394.788s |
| WebKit full shard 2 (`convergence-full-webkit-2.log`) | Exit 0, 39 passed; one Chromium-CDP-only native-touch skip | 535.790s |
| WebKit full shard 3 (`convergence-full-webkit-3.log`) | Exit 124 at unchanged 600s job budget; stale recurrence-entry helpers and unrelated-alert scoping exposed; failed/unreached cases rechecked below | 601.329s including cleanup |
| WebKit corrective journeys (`convergence-webkit-corrections.log`) | Exit 1, 26/27 passed; remaining added test expected the wrong conjunction copy, corrected without changing application behavior | 359.323s |
| Both engines: final stage/deadline/filter and simple-editor checks (`convergence-extra-final.log`) | Exit 0, 6/6 passed, including the corrected copy expectation and latest editor layout | 73.556s |
| Both engines: final simple-editor smoke after concise priority prompt (`convergence-extra-priority-final.log`) | Exit 0, 2/2 passed; an additional actual LAN check verified the selected null value and concise prompt | 23.851s |
| Final production build (`convergence-build-6.log`) | Exit 0, server/web/SW | Not a suite timing gate |
| Final strict bundle inventory (`convergence-bundle-6.log`) | Exit 0, 164886 bytes gzip including SW, strictly below approved 170000 | Not a suite timing gate |

`convergence-browser-manifest.json` and `convergence-coverage.json` reconcile unique case titles across the full runs and corrections: **237 passing browser cases, one documented engine-specific native-touch skip, zero missing cases**. Failed/interrupted jobs retain their original exit codes and are never relabeled as passing. All first-shard failures and budget-unreached cases have positive corrective evidence. WebKit's intentionally blocked service-worker registration can also report a shell-cache warning; move-error assertions now target that move error specifically and preserve unrelated storage diagnostics.

Full quality commands under pinned Node24.22.0/npm11.19.1 completed successfully (`convergence-quality.json`): typecheck 42.153s, lint 76.185s, format 28.126s, runtime 1.044s, bundle inventory 0.629s. Subsequent small editor-spacing/prompt changes and added test copy received focused lint, web typecheck, formatting, both-engine editor checks, a fresh production build and fresh bundle accounting. No dependency, case/job budget or 170000-byte ceiling was changed.

I reviewed actual final LAN screenshots in both engines against the accepted HTML sketch: home, board, search, filters, task and project editor; secondary navigation and error/offline behavior are covered by the corresponding browser journeys. The 320px history heading stays on one line, the source/formatting tools remain secondary, and the unset-priority prompt is concise. Search controls and visible return actions fit; no horizontal page overflow was observed. Recorded real data/required guards remain distinct from the synthetic sketch sample. Physical phone hardware and human visual acceptance remain separate.

The final real application responds successfully at `http://192.168.1.203:3000/`, including its emitted JS/CSS assets. The LAN bridge and production server were restarted/verified for the final build. Reload an existing tab to load it. Existing drafts remain protected. One archived demonstration description still has its original source; it was not restored or edited to bypass the archive guard.

## Phase 8: Editor follow-ups

User review added FR-024–027 / SC-020–023. Regression-first checks against the previous production build reproduced clipped description text (585px scroll height inside 143px visible height), hidden project emoji, and missing dirty-navigation confirmation. The initial deadline-only check was insufficient, so the replacement fixture creates an actual Eisenhower project and opens both controls together.

Descriptions now autosize on load, edits and viewport resize, including textarea borders; exact source stays unchanged. Project emoji is a primary field in both creation and editing. Expanded compound priority and deadline controls occupy normal full-width rows. Checkbox marks measure 18px; associated labels retain at least 44px activation areas. There are no new dependencies or backend/schema/API changes.

Dirty task/project departure uses native confirmation, including internal links, project close/Back and browser history. Rejected Back restores the prior history entry before notifying the router, so the current form remains mounted with its exact draft. Accepted departure preserves existing IndexedDB recovery and performs no implicit API write. Native reload/close has the browser's unsaved-change guard. Explicit task discard and successful save clear the warning; saved task creation replaces its route while retaining managed history. Existing draft-recovery tests explicitly accept native document-leave dialogs where recovery is their intended scenario.

### Verification and evidence

All paths below are under ignored `artifacts/mobile-ux/`; exact browser commands, exits and durations are retained under `artifacts/checks/2026-10-23T03*-browser.json`.

| Check | Result |
| --- | --- |
| New navigation, project close, native reload, exact draft recovery, untouched forms and task creation (`unsaved-green-2`, `unsaved-green-webkit-2`) | 12 passing cases across Chromium/WebKit; 45.219s / 78.262s |
| Description/emoji/Eisenhower+deadline at 320/390px (`editor-layout-green-final`) | 6/6 passing cases across both engines; 119.224s |
| Existing project editor and task source/save/discard/nested dialog cases (`editor-followup-green-1`) | All 16 applicable cases passed in both engines; initial new-case failures are retained and superseded by focused green runs above |
| Offline, epoch restore, project cleanup recovery and archive checks (`editor-followup-safety-chromium`) | 11/11 passed; 85.978s |
| Same recovery checks in WebKit (`editor-followup-safety-webkit`) | 10 passed; the combined cold offline reload/reopen journey exceeded the unchanged 30s case budget under host load. It was split into two independent journeys with every original assertion retained; corrective evidence is below |
| Existing ordinary workflows, exact source/precise deadline/DST, occupied emoji, archived views, duplicate submit and stale consent (`editor-followup-task-safety`) | 11/11 Chromium cases passed; 61.930s |
| Full runtime/type/lint/format/bundle gates (`editor-followup-quality.json`) | All exit 0; final small sizing/test adjustments received another full typecheck and lint, with final formatting recorded separately |
| Production build (`editor-followup-build-final.log`), strict bundle (`editor-followup-final-bundle.log`) | Exit 0; total JS+SW gzip 165558 bytes, below unchanged approved 170000 ceiling |

The first combined post-change run exposed the textarea's two missing border pixels and a relative-URL fixture setup mistake; both were corrected and the exact cases now pass. Its failures were not relabeled. A later repeated full lint command was terminated with exit 143 after typechecking; a subsequent standalone full lint completed with exit 0 (`editor-followup-final-lint-2.log`). No hooks, browser budgets or bundle checks were bypassed.

Actual LAN HTTP was reviewed in both engines at 320/390px. Screenshots are `editor-followup-live-{task,project}-{chromium,webkit}-{320,390}.png`; compound-control screenshots are `editor-followup-eisenhower-*.png`, and source/height evidence is `editor-followup-long-*.png`. The original sketch remains unchanged. I inspected the screenshots: the full description including its final line is inside the growing editor, checkbox visuals are compact and priority/deadline no longer overlap; the project emoji is visible without advanced settings. `editor-followup-live-review.json` records matching scroll/client description heights, no horizontal page overflow, insecure HTTP and successful final JS/CSS asset responses. The LAN production server was restarted after the final build; `http://192.168.1.203:3000/` is available. Native SQLite integrity is ok, foreign-key violations zero, and live data remains 4 projects/29 tasks. These UI fixes did not modify demonstration data. Physical phone hardware and human acceptance remain separate.

Backend functional/contention reruns are not required for this presentation/navigation-only follow-up under Constitution VI's proportional-check rule. Existing explicit-save, archive, source, consent, conflict, recovery and offline browser coverage was retained and rechecked. Checklists were read as a gate (16/16 checked); no reviewer-owned markers were changed and no extension hooks were present.

Cold offline reload/source safety and close/reopen timestamp preservation now have separate cases; every original assertion remains. Chromium passes both (`editor-followup-offline-split`). WebKit's system libproxy settings subprocess added substantial page-startup delay while the shared 8-core host load rose above 25. Disabling video capture alone did not fix it; those failed attempts retain their exit codes. With `GIO_USE_PROXY_RESOLVER=dummy` for the test process only (direct local HTTP, ordinary browser config, video and traces enabled), cold reload/source safety passes in 22.0s (`editor-followup-offline-webkit-proxy`). The subsequent reopen case in that job failed before application startup at the unchanged 8s fixture readiness gate; its isolated final result is recorded separately. No application proxy setting, test assertion, 30s case budget, 600s job budget or readiness timeout was changed.

Final corrective WebKit reopen result: **exit 0**, case 19.9s, complete job 35.807s (`editor-followup-offline-webkit-reopen-final`), with the same direct-local-proxy environment and ordinary recording configuration. All retained requirements have positive passing evidence: **69 unique applicable browser cases** across the focused runs and corrections, including **18 new editor/navigation cases**. Failed attempts remain recorded; none is counted as passing. Full final lint and format checks completed with exit 0; focused lint after the test split and scoped final spec formatting also passed. T022–T026 are complete. No dependency, mutation contract, live task/project data, Git hook or budget was changed.

### Push CI reconciliation

The first push of `c1c71cf` ran CI [39901451006](https://github.com/mikhailsal/ai-tasks/actions/runs/39901451006): quality/build, both functional shards, independent-process contention, both WebKit shards and Chromium shard 1 passed. Chromium shard 2 had one failure in the native-touch board journey (57 other cases passed).

The retained trace's actual POST targeted the neighboring “Соседняя задача” in `plan`, rather than the expected first card in `ideas`; the response was 200 and the `ideas` order correctly remained unchanged. This is evidence of the coordinate-based test touching the wrong column after its preceding native scroll/tab switch, rather than evidence of a failed persisted order write. A proposed pointerup change was not applied because it would not explain the different task identity in the trace.

Before CDP touch input (which bypasses locator actionability), the test now waits for a stable visible handle, initial-column scroll alignment and hit-target ownership. It also checks the drag ghost's task title and matches the position request to the expected task ID. Actual vertical/horizontal touch input, the no-write swipe snapshot and the persisted second-position assertion remain. No timeout, retry or application code was changed. Five consecutive focused Chromium cases passed; focused ESLint and root strict TypeScript checking passed. Evidence is under ignored `artifacts/mobile-ux/ci-native-touch-{stable,lint,typecheck}.log`; the original trace is retained under `ci-first-chromium-2/`. The corrective push receives a new complete CI run; its result is checked against the pushed SHA.
