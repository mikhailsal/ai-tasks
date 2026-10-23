# Implementation Plan: Project-first mobile Kanban

**Date**: 2026-10-23 | **Spec**: [spec.md](spec.md)
**Status**: Sketch A accepted as the visual direction; project search and a compact ordinary/recurring segmented switch in the search/add toolbar row added from user feedback. The user accepted the sketch and authorized implementation and a final commit; implementation and required validation are complete, with runtime evidence in quickstart.md. Previous list-first implementation is an unaccepted prototype.

## Summary

Project chooser → selected-project board → task detail. Implement a mobile board with horizontally adjacent workflow-stage columns, native horizontal snap/independent vertical lists, and compact task interactions. Preserve existing protections and secondary views; add shared-database-authoritative board ordering and guarded task transfer alongside the broad deadline read filter and exact-day tag read filter. See [mobile UI contract](contracts/mobile-ui.md). The standalone sketch remains synthetic; its localStorage state demonstrates sample behavior only and is never evidence of production shared persistence.

## Technical Context

- Existing pinned Node 24.22.0/npm 11.19.1, strict TypeScript, React/Vite/Tailwind/TanStack Query; no new UI/gesture dependencies.
- Existing SQLite, service worker and IndexedDB snapshot/draft contracts. Column/scroll position is presentation state. Manual task order is shared persisted application state scoped by project + kind + status; task transfers remain explicit guarded mutations.
- Target 320/390/430px mobile viewports and centered max-430px presentation on wider displays. Horizontal movement is confined to the board's inner container; native vertical card scrolling and reduced motion remain usable.
- Existing project config/task reads, bounded per-column pagination and cache keyed by project/kind; project-wide search reuses server-side `q` and explicit project/kind/filter scope, not client-only loaded-card filtering. A new board-order operation and guarded transfer contract require service/API/CLI parity, idempotency and optimistic concurrency review. The planned optional `deadline_preset` covers broad toolbar presets. Contextual deadline tags additionally require an exact-local-calendar-day shared read extension (for example an exact-day input), never substituting `from_tomorrow` or another broader preset. The exact-day predicate must use the application timezone and frozen `as_of`/cursor semantics; old reads remain identical when omitted. Query status IDs, not categories. If exact total counters require a new endpoint, review that scope separately; partial counts must be explicitly partial.
- Playwright Chromium/WebKit real isolated SQLite fixtures, Vitest functional/contention, typecheck/lint/format/build; emitted JS gzip strictly below the approved temporary 170000-byte limit including SW/lazy chunks (baseline 150000; exception below). No new timing gate.

## Constitution Check

Pre/post-design review covers I thin adapters (shared core read predicate and shared board-order/transfer semantics with thin transports), II explicit project scope and audit (including new order/transfer commands), III deterministic CLI (backward-compatible reads and new order/transfer parity), IV mobile/offline (one visible centered column, inner-board swipe, fetched-only offline reads), V functions/types/boundaries (existing browser-safe types), VI proportional regression-first real-fixture checks, VII bounded requests/build budget, and governance/honest evidence/no hook bypass. No constitutional amendment is proposed: adjacent offscreen board columns remain inside the single mobile viewport; multi-column desktop layouts remain out of scope. Revisit if design changes that boundary.

## Project Structure

```text
web/src/app/{App,router,styles}
web/src/screens/{Projects,ProjectDetail,ProjectBoard,TaskDetail,TaskSavedDetails,TaskControls}
web/src/components/{TaskCard,Button,OfflineBanner,AppNavigation,Modal}
web/src/data/{board,board-links,board-reading}.ts
existing secondary screens/filter/preview helpers
specs/002-mobile-ux/{spec,plan,research,data-model,quickstart,tasks}.md
specs/002-mobile-ux/contracts/mobile-ui.md
tests/{e2e/mobile-ux.spec.ts,fixtures/mobile-ux.ts}
```

Components/modules are organized by coherent responsibilities; BoardColumn and gesture/session hooks live under web/src/screens/. Existing routes remain supported; add `/projects/:slug/board` as a frontend route and default project destination.

## Phases

1. **Discussion and visual design**: sketch A project-home/board/detail is accepted as the visual direction. Add functional standalone search to review. Record proposed defaults and offline-column behavior separately; application implementation now follows explicit user authorization after design review.
2. **Regression first**: seed custom workflow with six stages, same-category statuses, long/empty/multi-page columns, archived and recurring examples. Reproduce project-first/gesture/cache-refresh failures before code changes.
3. **First usable slice**: project entry, board stage model, bounded reads, native horizontal snap and vertical lists, equivalent stage navigation, task detail/back position and post-mutation refresh.
4. **Visual checkpoint**: inspect real 320/390px Chromium/WebKit board/detail screenshots and actual gestures before applying secondary polish.
5. **Preservation and acceptance**: offline/unfetched/paging/config/epoch cases; secondary menus and all existing operations; complete applicable suites/quality/build/bundle checks. Human acceptance remains separate.

## Verification matrix

| Requirement / outcome | Verification / task |
| --- | --- |
| FR-001, SC-001 | Project-first entry, one-selection board, explicit project create/initial stage, empty/archive states; T001/T002/T004 |
| FR-010, SC-006 | Real touch left/right sequence, no wrapping, independent vertical scroll, settled column, keyboard/selectors, same-category custom IDs; T002/T005/T006 |
| FR-011, SC-007 | Detail/back stage+position, write then return with fresh membership, config/epoch reconciliation and no duplicates; T002/T007 |
| FR-003/004/008, SC-004 | Compact contextual cards, readable supported Markdown and all existing guard/consent/source cases; T008/T010/T012 |
| FR-002/006/009, SC-005 | Compact freshness, per-column snapshots/paging, truthful partial counts, cached/unfetched neighbor/reopening, errors, disabled writes/drafts; T005/T009/T012 |
| FR-014, SC-010 | Same-row filter action, model-aware choices, AND/search/reset/cancel, independent kind state; shared server read preset with injected-time boundary/DST/null/recurring/cursor/transport tests; T002/T005/T011/T012 |
| FR-013, SC-009 | Visible ≥44px segmented switch at 320/390, kind-scoped columns/search/create, separate reading positions, recurring parent lifecycle, no mutation on toggle; T002/T005/T007/T011/T012 |
| FR-012, SC-008 | Real project-scoped `q` queries find title/description matches in unfetched stages/pages; retained query/detail-back/cancel and honest offline search; T002/T005/T011/T012 |
| FR-015/016, SC-011/012 | Shared DB-authoritative order independent of browser storage, deterministic initial order, append for creation/non-positioned entry, explicit-position cross-column insertion, filtered/partial reorder disablement, guarded atomic transfer, conflicts/rollback, gesture distinction, edge navigation and keyboard/menu parity; T002/T005/T006/T007/T012 |
| FR-017–019, SC-013/014/019 | Shared database is authoritative and clearing browser storage does not lose or alter order; vector search icon and narrow emoji/title wrapping; outside/backdrop/Escape/Cancel always discard and never apply/confirm pending dialogs, filters or drag; T002/T003/T006/T007/T010/T012 |
| FR-020/023, SC-015/018 | Detail opens directly editable with explicit Save/Cancel and preserves read-only/offline/guard/conflict/draft/exact-Markdown behavior; visible immutable audit history shows actual stage/order events when available and truthful paging/loading/empty/error/offline states; T002/T008/T009/T010/T012 |
| FR-021/022, SC-016/017 | Exact priority, exact local calendar day and exact configured status tags open same-project/same-kind list with visibly removable filter, compatible dimensions preserved and same dimension replaced; tags do not open/drag card; blocker remains explanatory; project title opens selected project editor and Back restores board context; T002/T004/T005/T008/T010/T011/T012 |
| FR-005/007, SC-002/003 | All prior destinations/filters, visible active context, touch/focus, inner-only overflow, actual reviewed screens; T006/T010/T011/T012 |
| I–V / existing mutation correctness | Existing functional/core/CLI/API tests remain required. New order/transfer operation requires shared validation, ownership, idempotency, version/revision preconditions, atomic rollback and service/API/CLI parity tests. UI transition/refresh cases are required; T012 |
| VI actual contention | Existing independent-process real-DB suite retained; exercise concurrent order revisions and task transfers through real DB/lock paths; T012 |
| VII bounded work | Inspect requests: no per-card or unbounded initial fetch, maintain cursor scopes. Deadline read-predicate/query-plan review is required against representative data; new indexes require measured need. Broad backend/runtime benchmarks remain out of scope absent such need; T005/T013 |
| V/VII/workflow | runtime/typecheck/lint/format/build/bundle, traceability/evidence/no hook bypass; T013/T014 |

Use existing 30s browser-case/600s job and separate 180s functional/contention budgets. Preserve assertions when updating superseded navigation expectations. Actual directional gesture tests complement geometry; a programmatic scroll alone is insufficient evidence of touch usability.

## Migration and recovery

Migration `0003_shared_board_order.sql` adds `board_order` and `board_columns` for all tasks, including archived parents, with deterministic populated-database initialization. The `task.position` mutation reuses the existing transition implementation within the same guarded transaction and captures task/config/settings/source-order/destination-order preconditions. See [board API/CLI contract](contracts/board-api.md). Keep optional `deadline_preset` for the existing broad toolbar choices and add a distinct optional exact local calendar-day task read input for clickable deadline tags; do not map an exact-day tag to `from_tomorrow` or another broad preset. Carry both through shared core, API and CLI, preserving old behavior when omitted. Exact-day interpretation uses application timezone and frozen `as_of` across pagination/cursors. Update read contracts and real boundary/transport/cursor tests. Keep live demonstration data untouched; isolated synthetic fixtures only. Board scroll/selection state may use an explicitly versioned presentation key with stale-status reconciliation. Existing source, sanitizer, epoch/revision, retry, confirmation and draft semantics remain authoritative. Frontend rollback requires no DB restoration.

## Complexity Tracking

| Rule | Approved exception / rationale | Risks and compensating checks | Owner / expiry |
| --- | --- | --- | --- |
| Constitution VII: summed emitted JavaScript <150000 gzip bytes | On 2026-10-23 the user explicitly selected “Разрешить временно 170 000” after reviewing the measured 162556-byte build. For feature 002 only, enforce a strict <170000-byte ceiling. Existing React UI plus retained safety/offline/recovery views and the board exceed 150000; isolated chunk/minifier/JSX experiments did not meet the baseline. No dependencies were added. | Up to 20000 additional compressed bytes. Continue counting every emitted JS asset independently at gzip level 9, including SW/lazy chunks; exact boundary and inventory-tamper tests remain mandatory, as do mobile/offline checks. Never externalize assets or bypass hooks. The constitution baseline itself is unchanged. | Project maintainer. Review and remove this exception before the next feature or frontend dependency upgrade, whichever comes first; return the checker to 150000 once all emitted JS measures below that baseline. If it cannot be removed then, obtain fresh explicit approval before dependent work. |

Previous list-prototype evidence remains historical. This exception does not waive any other quality, runtime or acceptance gate.
