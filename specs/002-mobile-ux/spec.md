# Feature Specification: Project-first mobile Kanban

**Feature**: `002-mobile-ux`
**Created**: 2026-10-23
**Updated**: 2026-10-23
**Status**: The user accepted sketch A and explicitly authorized application implementation and a final commit. All 23 functional requirements and 19 success criteria remain in scope. The first application transfer exposed functional and visual gaps in user review; Phase 7 of tasks.md records their convergence and renewed runtime/visual evidence in quickstart.md. Human acceptance of the real application is separate.

**Input**: Work by selecting a project, then see its tasks by workflow stage on a mobile Kanban board. Swipe horizontally between neighboring columns, as in Trello. Keep the interface compact and app-like while preserving existing operations and data protections.

## User Scenarios & Testing

### User Story 1 - Open a project and see its work (Priority: P1)

The first screen contains projects. Selecting a project opens its task board directly, rather than a settings/detail page or a combined-project task list.

**Why this priority**: The user works within one project at a time.

**Independent Test**: Open the application, select a named project and reach its board with the correct project context and an obvious add action.

**Acceptance Scenarios**:

1. **Given** several active projects, **When** opening the application, **Then** readable project names and emoji appear; selecting one opens that project's board in one selection.
2. **Given** no projects, **When** opening the application, **Then** an understandable empty state offers project creation.
3. **Given** a board, **When** adding a task, **Then** its project is already selected and visible; task creation still uses the project's configured initial stage.
4. **Given** an archived project, **When** opening it, **Then** reading/history/restoration remain available and ordinary writes remain disabled with an explanation.

### User Story 2 - Swipe through workflow stages (Priority: P1)

The board contains neighboring columns corresponding to the project's configured stages. A horizontal finger swipe moves through columns; tasks inside a column scroll vertically.

**Why this priority**: The user wants to understand which tasks are at which stage, using familiar mobile-board gestures.

**Independent Test**: In a project with custom stage names and enough cards to scroll, swipe left/right, scroll cards vertically, open a task, then return to the same stage and reading position.

**Acceptance Scenarios**:

1. **Given** configured stages, **When** opening the board, **Then** their configured names/order appear as neighboring columns and each task belongs to exactly its current stage. Stages sharing a general category remain separate.
2. **Given** a current column with a neighbor, **When** swiping horizontally, **Then** the neighboring column slides into view and settles at its reading position. Repeated swipes reach all columns; ends do not wrap around.
3. **Given** many cards, **When** swiping vertically inside the current column, **Then** cards scroll without accidentally switching stages. Horizontal board swiping never changes a task's status; explicit card drag may do so under FR-016.
4. **Given** a narrow phone, **When** viewing the board, **Then** one readable column occupies most of the available width and a narrow part of its neighbor suggests horizontal movement. Multiple tiny columns are never squeezed onto the phone.
5. **Given** touch is unavailable, **When** using stage selectors or a keyboard, **Then** the same columns remain reachable with visible focus.
6. **Given** a task opened from a column, **When** returning, **Then** the previous column and its vertical position are restored. A successful edit/transition refreshes the board and moves the task to its actual stage without duplicates or manual refresh.
7. **Given** an empty or partly loaded column, **When** viewing it, **Then** empty, loading, missing-cache and failed-load states are distinct. Counts never present a loaded subset as a complete total.
8. **Given** an unfiltered, fully loaded column, **When** deliberately dragging a card to another position, **Then** its new order survives reload and is visible on another device without changing priority or stage.
9. **Given** a draggable card, **When** moving it to a permitted neighboring stage using edge navigation, **Then** releasing it requests the existing guarded transition and chosen position. Required confirmation/data are collected before saving; refusal, cancellation or conflict preserves the prior state.

### User Story 3 - Read and act without interface clutter (Priority: P2)

Cards show the information needed to choose work. Detail actions are easy to find; project settings, history, overviews and recovery remain accessible without dominating the board.

**Why this priority**: The result must feel usable on a phone, rather than merely satisfy width constraints.

**Independent Test**: Read a card, open a long description, perform an allowed transition and reach secondary operations while preserving existing safety and offline behavior.

**Acceptance Scenarios**:

1. **Given** cards in a named project/stage, **When** scanning them, **Then** titles/emoji are primary; assigned deadlines/priorities and blockers are compactly visible without repeating the same project/stage text on every card.
2. **Given** detail or editing, **When** acting, **Then** primary/secondary/dangerous actions are distinct; descriptions remain readable and existing confirmations/conflicts/dependency restrictions are retained.
3. **Given** normal connectivity, **When** viewing projects or a board, **Then** synchronization occupies a compact line; offline/errors/maintenance remain noticeable and the last successful refresh remains available.
4. **Given** previously loaded information, **When** reopening offline or reconnecting, **Then** cached project/column/detail data remain readable, unfetched data are explained, writes are disabled offline and drafts survive reconnect/epoch changes.
5. **Given** secondary operations, **When** opening the project/application menu, **Then** configuration, recurring tasks, history, cross-project lists/agenda/priorities/workload, settings and backups remain reachable.

6. **Given** a selected project, **When** searching by task title or description, **Then** matching tasks from every stage of the current workflow are shown with their stage, including stages not currently visible. Opening a result and returning retains the query/results; cancelling search restores the board column and position.

7. **Given** a selected project, **When** the board opens, **Then** a compact “Обычные / Повторяющиеся” segmented switch shares one toolbar row with search and add and is immediately available without opening a menu. Switching shows the selected workflow's columns/cards in the same project, preserves each board's reading position and scopes search/adding to that type.

8. **Given** a project board, **When** opening the filter button beside search/add, **Then** a compact panel offers model-aware priority and deadline choices. Applying combines conditions across all stages, shows the active selection and supports one-action reset; search respects the same filters.

#### User Story 4 - Edit task details directly (Priority: P1)

Task detail opens ready for inline editing, with explicit Save and Cancel for drafts. History is visible as a discoverable section.

**Acceptance Scenarios**:

1. **Given** an editable task, **When** opening detail, **Then** title, emoji and description are directly editable without an Edit-mode step; Save commits the draft and Cancel discards it.
2. **Given** an existing task with read-only, offline, guarded or conflicting conditions, **When** opening/editing/saving, **Then** existing permissions, exact Markdown source, draft retention, guards and conflict behavior remain authoritative.
3. **Given** a task detail, **When** viewing it, **Then** a visible change-history section offers truthful loading, paging, empty, error and offline states and shows actual immutable audit events, including stage/order changes when recorded.

### User Story 5 - Navigate by project and task attributes (Priority: P2)

Project title opens that project's editor. Clicking a filterable task tag opens a project- and kind-scoped board/list with that filter visibly applied and resettable.

**Acceptance Scenarios**:

1. **Given** a selected project board, **When** clicking its project title, **Then** that project's editor opens and Back returns to the prior board context.
2. **Given** a clickable priority, deadline or stage tag, **When** clicking it, **Then** the same project's same-kind board/list opens with that dimension applied and visibly resettable; compatible other filters remain and a same-dimension selection is replaced.
3. **Given** a task card with tags, **When** clicking a tag, **Then** the action filters rather than opening the card or beginning a drag. Any blocker badge offered as clickable is a real supported filter; no new tag domain is invented.

## Edge Cases

- One stage, many stages, custom names/order, long labels, empty columns and several statuses in the same category.
- Empty projects, archived projects, completed/cancelled visibility and ordinary versus recurring workflows.
- Partial pagination, failed/unfetched neighbor columns, concurrent changes, stale cursors and configuration changes while a board is open.
- Directional gestures near page edges, long vertical columns, task-card taps, reduced motion and keyboard-only operation.
- Returning from detail, changing projects, offline reopening and different saved stage/scroll positions for each project.

## Requirements

### Functional Requirements

- **FR-001**: Home MUST show projects; selecting a project MUST open its board directly. Adding from a board MUST bind the selected project explicitly.
- **FR-002**: Connection state MUST remain compact in normal operation, with last successful refresh/manual refresh; offline/error/maintenance states MUST remain apparent.
- **FR-003**: Cards MUST prioritize task name/emoji and relevant deadline/priority/blocker information. Project and stage context MUST be visible without redundant repeated labels.
- **FR-004**: Actions MUST distinguish primary/secondary/dangerous purposes while preserving configured transitions, consent, dependencies, archives, conflicts and drafts.
- **FR-005**: Project switching and every existing operation/view MUST remain reachable through compact navigation and secondary menus. Combined-project views MUST NOT replace the default project-first journey.
- **FR-006**: Existing filters and snapshot/refresh information MUST remain accessible; active restrictions and incomplete result counts MUST be apparent.
- **FR-007**: The mobile viewport MUST retain one readable centered content column with accessible touch targets/focus. Board columns MAY extend horizontally inside the board; unrelated page content MUST NOT overflow sideways.
- **FR-008**: Descriptions MUST preserve exact source/safe preview and distinct headings, paragraphs, emphasis, lists, links and code.
- **FR-009**: Previously loaded information MUST remain readable on offline reopening. Unfetched columns MUST be distinguished from empty ones; writes stay disabled and reconnect retains drafts.
- **FR-010**: The board MUST represent configured stages as adjacent horizontally swipeable columns, preserve their order and support equivalent non-swipe navigation. Vertical task scrolling MUST remain independent; status changes require an explicit card drag or equivalent keyboard/menu action; ordinary swipes only navigate.
- **FR-011**: Opening/returning from task detail MUST preserve the board's selected column and reading position. Successful mutations and configuration changes MUST refresh/reconcile its displayed state.

- **FR-012**: A named search action MUST be available on the project board. Search MUST match title/description case-insensitively across stages in the selected project/workflow, honor visible filters and distinguish loading, no matches, errors and unavailable offline search. Results MUST identify their stage; clearing/cancelling and returning from detail MUST preserve the relevant board/search context. Search MUST NOT be limited silently to already loaded cards.

- **FR-013**: A labeled “Обычные / Повторяющиеся” board switch MUST remain immediately visible in the same compact toolbar row as search, filters and add, including during search; it MUST NOT occupy a separate full-width row. Switching MUST retain project scope, show the selected workflow's stages and preserve separate per-project/type column/scroll/search context. Recurring cards represent parent tasks, not individual occurrences; switching alone MUST NOT mutate tasks or recurrence state.

- **FR-014**: The toolbar MUST expose a labeled filter action beside search/add. A secondary panel MUST offer the project's priority choices and deadline presets: any, overdue, today, tomorrow and later, next three calendar days, and no deadline. Combine the selected priority and deadline with AND, show active conditions/reset, retain them separately per project/type and apply them to board counts and search. Calendar presets MUST follow the application's timezone and a stable result-set reference time; recurring deadlines mean the earliest unclosed occurrence. Filters MUST cover the complete eligible dataset, not silently filter only loaded cards.
- **FR-015**: Each project, task kind and workflow status MUST have a manually ordered board list persisted as shared application state, visible consistently across devices and reloads. Order MUST be independent of priority/deadline sorting. Initial order MUST be deterministic. New tasks and tasks entering through non-positioned lifecycle actions MUST append. A board cross-column drag MUST insert at the user-chosen known destination position; it appends only when the user chooses the end. Reordering MUST be disabled while filters/search are active or the target column is only partially loaded, so hidden/unknown tasks are never treated as absent.
- **FR-016**: A deliberate long-press on a visible task's drag handle MUST allow moving it within its column or to a permitted destination status, with edge auto-advance between columns. Ordinary horizontal/vertical swipes MUST never mutate task state. A successful cross-column drop MUST use existing lifecycle transition guards, including consent, dependencies, required fields, archive and offline rules. Invalid drops restore the card; conflicts MUST be surfaced without silent retry. Provide keyboard and menu equivalents. Concurrent edits MUST never silently overwrite another user’s order or task changes. A transfer MUST save the stage and position together, or preserve the previous state completely; technical operation design belongs in the plan.

- **FR-017**: Shared board order MUST be authoritative application data, visible consistently across devices and independent of browser/device storage. Local storage alone MUST NOT satisfy persisted ordering.
- **FR-018**: Search MUST use a clear, consistent icon that renders without visual defects. Task emoji and title MUST share the top row when space permits, with the title wrapping correctly on narrow screens.
- **FR-019**: Pressing the modal backdrop/outside, Escape, or Cancel MUST discard pending dialog changes and behave as Cancel; these actions MUST never Apply or Confirm, including while filters or drag state are pending.
- **FR-020**: Task detail MUST open directly editable without a separate Edit mode. Explicit Save commits drafts and Cancel discards them while all existing read-only, offline, guard, conflict, draft and exact-Markdown protections remain in force.
- **FR-021**: Clicking an exposed filterable task tag MUST open a board/list scoped to the same project and task kind with that filter visibly applied and resettable. Supported dimensions include priority, deadline and stage; replace a selection in the same dimension, preserve compatible filters, and do not open/drag the card. Any clickable blocker badge MUST map to an actual supported filter; no new tag domain is introduced.
- **FR-022**: Clicking a project title on its Kanban board MUST open that selected project's editor; Back MUST restore the prior board context.
- **FR-023**: Task detail MUST expose a discoverable change-history section backed by actual immutable audit events. Show stage/order changes when available and truthful loading, paging, empty, error and offline states; never fabricate history.


### Key Entities

Existing project, task, workflow status and snapshot meanings are unchanged. A board column represents one configured status, not a new persisted domain entity. Ordinary and recurring workflows remain distinct. Shared task positions within each project/type/stage are new persisted application state.

## Success Criteria

- **SC-001**: At 390×844, a nonempty home shows a complete project entry; selecting it opens its board in one selection. Its first nonempty column shows an add action and a complete card without scrolling in normal operation.
- **SC-002**: At 320/390/430/1280 widths, the centered mobile viewport is at most 430px and every interactive target is at least 44×44px. Horizontal overflow is confined to the board; cards/menus/forms remain readable.
- **SC-003**: Every former view remains reachable within two secondary-navigation selections; complete filters and separately labeled snapshot/refresh information remain available.
- **SC-004**: Cards/detail expose FR-003 context; supported descriptions are visually distinct and prohibited content never executes. Primary/secondary/dangerous actions are distinguishable in actual reviewed screens.
- **SC-005**: Offline/reopening, missing cache, disabled writes, reconnect drafts and failed refresh preservation pass the retained acceptance journeys, including unfetched columns.
- **SC-006**: In a seeded project with at least six stages and a long task column, left/right gestures reach each adjacent stage in order and settle on a column; vertical gestures scroll cards without switching stage. Stage selectors/keyboard reach the same columns.
- **SC-007**: Returning from detail restores the previous column/scroll position; an accepted task transition updates its membership exactly once without a manual refresh. Custom statuses sharing a category remain separate columns.

- **SC-008**: In a project with a matching task in another stage and beyond the first loaded page, a title/description query finds that task and shows its stage without mixing projects. Clear, no-match and detail/back journeys retain the intended query/column context. Missing offline search data are not shown as a complete empty result.

- **SC-009**: At 320px and 390px, both board-type choices share the search/filter/add toolbar row and are visible and operable without a menu or page scroll. Switching twice restores each board's previous stage/position; search and adding stay in the selected project/type and no task-state write is issued by switching.

- **SC-010**: At 320/390px, type switch/search/filter/add fit one toolbar row. Applying “Высокий” + “Сегодня” shows only tasks matching both throughout the current project/type, including matches beyond the first fetched page. “Завтра и позже” excludes today; “Ближайшие 3 дня” includes today plus the next two calendar days. Active conditions, reset, cancel-without-applying, scoped search and per-type retention pass observable journeys.
- **SC-011**: Reorder tasks within a status, reload and view on another device, and observe identical order; verify append behavior for creation/non-positioned lifecycle entry, explicit-position cross-column insertion (append only when end is chosen), deterministic initial ordering, independent priority/deadline views, and disabled reorder with any active filter/search or partial target data.
- **SC-012**: Actual touch tests distinguish long-press handle drag from ordinary horizontal/vertical swipe; test within-column and cross-column drag, edge auto-advance, invalid status/guard rollback, offline/archive, stale task version and order-revision conflict with no silent retry, and keyboard/menu equivalents.

- **SC-013**: At 320px, search renders a clear icon without visual defects; emoji/title share a row when possible and long titles wrap without clipping.
- **SC-014**: Backdrop/outside press, Escape and Cancel discard pending modal edits/filters and never Apply/Confirm; verify each with pending changes and drag state.
- **SC-015**: Detail opens directly editable; explicit Save commits and Cancel discards while read-only/offline/guard/conflict/draft and exact-Markdown cases retain existing behavior.
- **SC-016**: Clicking priority, deadline and stage tags opens same-project/same-kind results with exact priority, exact local calendar day or exact configured status filter visibly removable; compatible dimensions persist, same-dimension selection is replaced, and no card open/drag occurs. Blocker remains explanatory.
- **SC-017**: Clicking a board project title opens that project's editor; Back restores board project, selected stage and reading position.
- **SC-018**: Detail displays discoverable immutable audit history with actual recorded stage/order changes when available and truthful loading, paging, empty, error and offline states; no fabricated events.
- **SC-019**: Board order remains identical across reloads/devices when saved by the application, even with browser storage cleared; browser-local order alone fails.

## Assumptions and decisions for visual review

- User-confirmed: projects first; select project then work; adjacent Kanban columns navigated with finger swipes.
- User-confirmed: ordinary and recurring boards are selected through a compact visible segmented switch on the same row as search/filter/add, without a separate full-width row or a hidden menu. Each uses its own workflow. Proposed default: open ordinary tasks initially; completed/cancelled visibility remains explicit.
- Proposed: a mostly full-width column with a small neighbor preview, stage name/count and a compact stage selector. Task drag and shared board ordering are now in scope; their persisted order operation and atomic guarded status-transfer contract require technical review.
- Existing data/protections/operation coverage are preserved. Deadline presets are an additive read-filter capability; task drag/order adds a new persisted write operation; existing transition semantics and guards remain authoritative. Data tests use synthetic isolated fixtures, never writes to the live demonstration database.
- The earlier list-first prototype is historical work; acceptance of this Kanban revision requires real application checks against these requirements.
- Sketch A (project home, swipeable board and task detail) was accepted as the visual direction; the user additionally requested task search. The accepted standalone sketch is versioned at `specs/002-mobile-ux/design/sketch.html` (session preview: `artifacts/mobile-ux/design/index.html`) and uses synthetic data only. The user subsequently authorized application implementation and a final commit after accepting the sketch.


## Application review clarification

The accepted HTML sketch is the visual reference for the primary screen hierarchy and editing flow. Descriptions open in an ordinary text editor; formatting and source tools stay secondary and never introduce content. Existing source and drafts remain exact. All secondary pages need visible contextual Back controls with a safe internal fallback. Normal board sync and stage position share a compact footer; application link controls retain the sketch hover appearance. Acceptance includes actual 320/390px screen comparison and an insecure LAN HTTP browser origin, where secure-context-only APIs cannot be assumed. Dismissible errors retain uncertain operations and immutable retry identities. These clarify FR-002–005/007/011/012/015–020/022/023 after the first transfer; they do not waive existing guards or constitute human acceptance.
