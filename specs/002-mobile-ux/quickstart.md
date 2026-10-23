# Validation guide: Project-first mobile Kanban

## Current status

The user accepted sketch A and explicitly authorized implementation and a final commit. The real application now implements project-first navigation, swipeable ordinary/recurring boards, complete server-side search and deadline/priority filtering, shared database order/guarded stage transfer, direct task editing, contextual tag navigation and actual audit history. Required checks are complete with the explicitly approved temporary bundle exception. Human acceptance of the real application remains separate.

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
