# Feature Specification: Complete AI Task Manager

**Feature**: `001-ai-task-manager`
**Created**: 2026-10-20
**Updated**: 2026-10-21
**Status**: Ready for implementation; original specification-quality checklist passes under constitution v3.0.0

**Input**: Provide one task manager for people and their external AI assistants. Organize work into independently configured projects, track exact deadlines and recurring obligations, and keep explanations and plans inside task descriptions. People use a mobile web interface; assistants use a non-interactive command interface. This release has no login. Telegram authentication is a future release.

## Clarifications

The user authorized the agent to resolve the remaining product questions and proceed to planning.
The defaults in Q01–Q19 are delegated decisions, not answers individually supplied by the user.
All product questions are settled. Earlier questions and answers, including superseded open
wording, are preserved in [research.md](research.md#clarification-history).

The original technical brief and engineering decisions are retained in
[plan.md](plan.md#engineering-detail-relocated-from-the-specification) and the interface
contracts. Moving that detail does not remove requirements or change previously agreed behavior.

## User Scenarios & Testing

All six stories are required for this release and have priority P1. Story priorities describe
delivery importance, separately from the priorities people assign to tasks. The following
scenarios define expected outcomes; they are not claims that tests have run.

### User Story 1 — Capture and advance work (Priority: P1)

Create and edit ordinary tasks with meaningful emoji, descriptions, optional exact deadlines,
and a workflow appropriate to their project.

**Independent test**: Create a project, capture work, advance it, and reopen the application.

1. Saved project and task information remains available after restarting the application.
2. The default workflow progresses from idea through planning, ready, in progress and review to done. It also supports the agreed backward moves, cancellation and reopening. A move not allowed by the project's workflow is rejected.
3. When a move requires confirmation, the assistant must provide both an explicit assertion of approval and the user's approval text. An assertion alone fails. Valid approval is recorded in history and does not require the user to repeat the action in the web interface.
4. Saving an edit based on an older version fails without replacing newer information. The proposed text remains available while the user reviews the current version.
5. Archiving hides work from active views while preserving its information and history. Restoration brings it back under the same rules. Permanent deletion, moving tasks between projects and changing project slugs are unavailable.

### User Story 2 — Configure projects and dependencies (Priority: P1)

Give each project its own workflow and priority meanings, and express prerequisites within
or across projects without losing the meaning of past decisions.

**Independent test**: Configure four projects differently and exercise valid and invalid changes.

1. Classic levels, the Eisenhower Matrix, custom named levels and a custom numeric scale coexist in different projects without changing one another's meanings.
2. Removing or replacing a status or priority requires an explicit replacement for every affected value. A valid change updates all affected work and its history together. An invalid change leaves everything unchanged. These explicit replacements do not require ordinary workflow moves or their confirmations.
3. History continues to show the original labels, categories and priority meanings after configuration changes.
4. A task cannot enter in progress, review or completed while a prerequisite is unfinished or cancelled. All completed prerequisites permit the move only if the other workflow and confirmation rules also pass. Self-dependencies and circular dependencies are rejected, including circles across projects.
5. Recurring tasks and their occurrences cannot participate in dependencies. An unmet prerequisite cannot be added to an already advanced task. Reopening a prerequisite does not automatically move its dependent tasks backward.

### User Story 3 — Use automation and history (Priority: P1)

Let external assistants perform the same agreed operations as people and inspect an accurate
history of what changed, who changed it and which approvals were supplied.

**Independent test**: Perform the same operations through the human and assistant interfaces,
including failures, repeated requests and competing changes.

1. Assistant operations never pause for interactive input. Success and failure are distinguishable, with consistent structured results and useful error information.
2. An attempt to change a task through the wrong project is rejected without changing work or recording a successful change. Combined-project reads require an explicit request for that scope.
3. Repeating the same successful request after a lost response returns the original result without repeating the change or its history. Reusing the request for different content is rejected.
4. Both interfaces expose all agreed operations and immutable before-and-after history. A separate history export is outside this release.
5. Competing changes either complete with their full history or return a controlled conflict. No successful update disappears, and waiting too long for another writer produces a useful failure.

### User Story 4 — Review priorities, deadlines and workload (Priority: P1)

Review work grouped by project, keeping each project's priority meanings intact.

**Independent test**: Compare ordered lists, deadline groups and counts across differently
configured projects, including unfinished recurring obligations.

1. Projects appear by descending project priority, with equal priorities ordered by slug. New projects start at 0. Within each project, assigned task priorities precede unset ones; ties use earliest deadline, oldest creation time and then task identifier. Missing deadlines follow present deadlines.
2. Classic order is critical, high, normal, low. Eisenhower order is important and urgent, important only, urgent only, then neither. An unset priority remains distinct from all four choices.
3. Ordinary deadlines may be absent, changed or removed. A date without a time is insufficient. Work is overdue only after its deadline and while neither completed nor cancelled.
4. The agenda groups work into overdue, today, the next seven calendar days excluding today, later and no deadline. The configured application timezone determines calendar boundaries.
5. A recurring task appears once, with its earliest pending or owed occurrence deadline. Without such an occurrence, it has no displayed deadline. Ordinary tasks and recurring occurrences have separate counts.
6. Paging through one result set keeps time-based groupings stable even if time passes. Refreshing starts a new view at the current time. If the underlying data changes, the user is asked to refresh rather than receiving inconsistent pages.

### User Story 5 — Manage recurring and maintenance work (Priority: P1)

Keep one recurring task with a history of individual occurrences, including missed work and
obligations that remain owed.

**Independent test**: Exercise calendar and completion-relative schedules with both miss policies,
including late completion, pauses and a period when the application was not running.

1. Either timing mode may independently carry a miss forward as debt or record a miss without a make-up obligation. The first deadline, miss policy and confirmation window are explicit.
2. Calendar schedules support every N days or weeks, selected weekdays and every N months on a chosen day. Missing month dates use month end. Late completion does not shift the calendar. Completion-relative hours or days run from actual completion.
3. A completion recorded exactly at deadline plus confirmation window is timely. Only a later uncompleted occurrence expires into debt or a recorded miss. Backdating actual completion does not make a late recording timely.
4. A debt or recorded miss may later be completed while retaining the original miss in history. Only selected occurrences are completed. Completion-relative work has no next deadline until actual completion occurs.
5. Pause creates no obligations for the paused period and never catches up that period on resume. Existing occurrences and confirmation windows continue. A service interruption catches up all obligations from active periods once.
6. Changes to recurrence settings or the parent description affect future occurrences. Already created occurrences retain their original deadlines, conditions and descriptions.
7. Pending or owed work blocks archival. While paused, a future pending occurrence may be cancelled with a reason; an owed occurrence cannot. Direct restoration returns recurring work to paused and requires approval when the configured restore move requires it. Missing approval leaves everything unchanged.
8. When resuming completion-relative work without an open occurrence, a candidate deadline that passed during pause requires an explicit new first deadline. No completion time or paused-period debt is invented.
9. Finishing an occurrence from an older schedule changes that occurrence and its history only; it cannot restart a retired schedule.

### User Story 6 — Use the mobile interface, offline mode and recovery (Priority: P1)

Manage all agreed operations in one mobile column and keep previously loaded information
readable when disconnected.

**Independent test**: Use narrow and wide screens, disconnect and reopen the application,
then reconnect and exercise backup and recovery.

1. The interface fills available width up to 430px, stays centered on wider screens and provides touch targets of at least 44px.
2. Emoji can be copied and pasted as ordinary text. A human or external assistant chooses meaningful markers; random assignment is unavailable. The default ⚪ may repeat. Reserved project markers cannot be assigned to tasks, and unfinished unarchived tasks cannot share a non-default marker within a project.
3. Completion, cancellation and task archival release task markers for reuse. A conflicting reopening or restoration requests a replacement when supported, otherwise uses ⚪. Past project markers remain permanently reserved, including after restoration from backup.
4. After a successful online opening, offline reload or reopening displays the saved application and previously loaded information, including descriptions. The interface shows offline status, last refresh and missing information. Writes and queued writes are disabled.
5. Reconnection refreshes information without discarding unsaved text. A stale save is rejected. A restored application requires fresh information and prevents changes based on its former state while preserving local drafts.
6. An archive blocked by open recurring obligations changes nothing. Successful project archival preserves individual task states. Restoring a project leaves formerly active recurring tasks paused, while preserving draft, already paused and individually archived children.
7. A verified manual backup can be restored from either interface in maintenance mode. Restoration retains the previous recovery copy and readable history from both current and backup state. No user sees a partial replacement, and requests based on the pre-restore state cannot change restored work.
8. If current history is unreadable, ordinary restoration refuses to proceed and preserves the damaged material for recovery. Conflicting historical records or project-marker ownership also reject restoration without silently dropping or rewriting them.

## Edge Cases

- Completion and automatic expiry occurring together must produce one consistent outcome under the inclusive confirmation-window rule. Backdated actual completion is different from the time the completion was recorded.
- Pauses and service interruptions have different consequences. Work owed before a pause is still owed; only periods that begin during the pause are skipped. Repeated catch-up cannot duplicate occurrences.
- Changing status labels cannot change their shared meaning. Configuration replacement is checked against the final affected state, and historical meanings remain readable.
- An unfinished prerequisite never silently rewinds dependent work. An archived completed prerequisite remains satisfied; an archived unfinished one does not.
- Visually identical emoji presentation variants count as the same marker, while skin-tone and joined-emoji distinctions remain meaningful. The default marker and emoji search never identify a unique task for changes.
- Interrupted restoration must leave a recoverable previous state and an inspectable recovery record. Missing history is not treated as if it had been reconstructed.
- An expired or removed offline copy produces an explicit missing-information message. Browser storage is not a substitute for a verified backup.

## Functional Requirements

- **FR-001 — Complete product boundary**: Deliver one task manager with a non-interactive assistant interface and a mobile human interface applying the same business rules. Internal AI orchestration, Telegram integration or login, desktop layouts and offline changes are outside this release.
- **FR-002 — Projects and tasks**: Create, read, edit, archive and restore projects and tasks. Preserve unique immutable project slugs and stable task identifiers, separately from emoji. No permanent deletion or cross-project task moves. Archived work is read-only except restoration and history access; an explicit configuration replacement may update archived task values only while its project is not archived. Recurring archival requires no pending or owed occurrences.
- **FR-003 — Project-scoped mutations**: Every change to project-owned work explicitly names its project and rejects a task belonging elsewhere. Multi-project restoration names every affected project. Combined-project reads require an explicit aggregate scope.
- **FR-004 — Durable atomic state**: Preserve committed work across application restarts. A change and all of its history succeed together or leave everything unchanged. Repeated successful requests cannot repeat changes. Surviving an application crash does not promise zero loss during a power failure.
- **FR-005 — Audit history**: Record the actor, origin, time, affected item and before-and-after values for every successful change. Retain the original meaning of configuration values. Record required approval assertions and user text. Both interfaces browse history; existing history cannot be edited or deleted, and a separate export is excluded.
- **FR-006 — Project priority models**: Support classic levels, independent importance and urgency, ordered custom names and bounded custom numeric scales with a chosen direction. Exclude calculated formulas and custom multi-axis models. New projects default to classic priorities; task priority is optional and initially unset. Q01–Q03 define exact limits and defaults.
- **FR-007 — Cross-project ordering**: Group work by descending project priority then slug. New project priority is 0. Within each project, use its own priority model, unset last, then earliest deadline with missing last, oldest creation time and task identifier. Do not convert different project models into one universal task priority.
- **FR-008 — Default ordinary workflow**: Provide idea, planning, ready, in_progress (in progress), sanity_check (review), done and cancelled, with the moves in Q04. The initial status is configurable and defaults to idea. Review to done requires approval by default.
- **FR-009 — Custom workflows**: Each ordinary status has exactly one shared category; each recurring status has exactly one lifecycle meaning. Projects configure allowed moves and approval requirements. Ordinary status changes follow these moves; explicit FR-010 replacements are the exception. Assistant approval includes both an assertion and the user's text for that operation without a separate web approval step.
- **FR-010 — Configuration migration**: Invalidating changes require complete explicit replacement mappings. Apply configuration, affected work and history together. Mapped replacements bypass ordinary moves and their approvals but still enforce dependencies. Preserve historical meanings. Renaming preserves identity; changed move rules affect future requests without moving existing tasks.
- **FR-011 — Recurring work**: Keep one parent task with individual occurrences. Independently choose calendar or completion-relative timing and carry-forward or record-miss treatment. Require a first deadline, miss policy and confirmation window. Follow Q07–Q09; preserve each occurrence's original description and conditions. Do not invent completion, forgive debt or catch up paused periods.
- **FR-012 — Exact deadlines**: Ordinary deadlines are optional, changeable and removable; every occurrence has an exact deadline. A separate scheduled-for field is excluded. One configurable application timezone, initially Europe/Moscow, controls entry, display and calendar recurrence. Overdue means strictly after deadline while neither completed nor cancelled. Q10 defines ambiguous times and daylight-saving behavior.
- **FR-013 — Description and plans**: Preserve free-form Markdown descriptions without mandatory headings. Assistant explanations and plans stay inside the description. There is no internal content generation. Replacing a description rejects stale edits while preserving the proposal. Occurrences retain their original descriptions. Structured section editing is excluded.
- **FR-014 — Read visibility**: Provide project and combined-project lists, agendas, priority views and workload counts with predictable filtering, search and paging. Q11 defines groups and counters. Interpret status categories consistently despite custom labels. Count ordinary work and recurring occurrences separately.
- **FR-015 — Assistant automation**: The assistant interface is non-interactive, supports consistent machine-readable results and clearly distinguishes successful results from failures. Invalid arguments also produce structured failures. Detailed technical contracts are retained in the planning documents; Interface Scope below identifies the affected user interactions.
- **FR-016 — Deterministic contracts**: Define stable ordering, time handling, conflict detection, retry behavior and errors. Equivalent human and assistant actions produce the same domain results. Reading information never changes work or its history.
- **FR-017 — Human interface behavior**: The human interface exposes the agreed operations through the application. It records human actions separately from assistant actions. Direct third-party automation uses the assistant command interface in this release. Protection against unrelated websites initiating changes does not introduce user authentication.
- **FR-018 — Mobile interaction**: Every agreed operation is available through the mobile and assistant interfaces. Use one centered column, width 100%, maximum 430px, with touch targets at least 44px. Include configuration, recurrence, dependencies, emoji, descriptions, archive and restore, history, backups and recovery. Human-facing copy is Russian; repository and protocol names are English.
- **FR-019 — Offline reads**: After successful online loading, retain the application and latest loaded work, priorities and descriptions for offline reopening. Show offline state, last refresh and missing information. Disable changes and write queues. Reconnection refreshes data while preserving unsaved text; restoring the application requires fresh saved views without destroying drafts.
- **FR-020 — Unauthenticated access**: Anyone able to connect may use the current read and write operations without an account, credentials or identity permissions. Domain rules, project scope and configured approvals still apply. Telegram authentication is a future release.
- **FR-021 — Conflicts and retries**: Reject changes based on stale work, configuration or a pre-restore state, preserving the proposed edit. Identical successful retries return the original result; reusing a request for different content fails. No silent overwrite or automatic description merge is permitted.
- **FR-022 — Recovery and compatibility**: Upgrades preserve existing work and history. Breaking interface changes document upgrade and rollback steps, including recovery of the previous working state. The initial release explicitly records that no earlier released format exists to upgrade. Manual full backup and restoration follow FR-026 and Q19.
- **FR-023 — Task dependencies**: Ordinary-task prerequisites may cross projects. Only completed work satisfies them; cancellation does not. Unmet prerequisites block moves into in progress, review or completed. Reject self-links, circles and recurring endpoints. Dependency changes never automatically move tasks. Adding unmet prerequisites to advanced work is rejected.
- **FR-024 — Task emoji**: A human or assistant chooses one meaningful emoji; no random assignment. The repeatable default is ⚪. Non-default markers are unique among unfinished unarchived tasks within a project and cannot be reserved by a project. Completion, cancellation and archival release task markers. Return conflicts request a replacement when supported, otherwise use ⚪. Markers appear in lists and details and can be copied as text.
- **FR-025 — Project emoji**: A new project needs a meaningful globally exclusive emoji, excluding ⚪. Its current and past markers remain permanently reserved, including after archival or backup restoration. They cannot be assigned to tasks or other projects. A marker already used by any task is rejected rather than rewriting that task's history.
- **FR-026 — Manual backup and restore**: Both interfaces support manual full backup and maintenance-mode restoration of work and settings. Exclude cloud backups and automatic schedules. Verify backup integrity and compatibility, retain a pre-restore recovery copy and combine readable immutable history. Reject conflicting history or project-marker ownership. Explicitly name affected projects, publish a complete restored state, and reject obsolete requests. Unreadable current history blocks normal restoration and the damaged material is preserved.

## Resolved Decision Register

All entries are settled under the user's delegation. Detailed mechanisms and exact technical
contracts are retained in [plan.md](plan.md#engineering-detail-relocated-from-the-specification)
and [contracts/common.md](contracts/common.md).

- **Q01 — Priority expressiveness (resolved)**: Custom numeric bounds are inclusive within −1,000,000,000 to 1,000,000,000, allow at most three decimal places and require a lower bound below the upper bound. The project chooses which direction is more important. Reject excessive precision instead of rounding. Named levels have distinct ordered positions. Classic meanings and Eisenhower axes remain fixed.
- **Q02 — Ordering (resolved)**: Project priorities are whole numbers from −2,147,483,648 to 2,147,483,647, initially 0. Duplicates are allowed; an explicitly missing value is rejected. Reset by entering 0. Slugs and stable task identifiers break ties in the documented fixed lexical order. Every page preserves project-first ordering and the rules in FR-007.
- **Q03 — Configuration defaults (resolved)**: Custom levels and all statuses may have names and optional colors from the fixed ten-color palette: slate, red, orange, amber, green, teal, blue, indigo, violet and rose. Color never conveys meaning alone. Only built-in presets are supplied; saved reusable custom presets are excluded. New ordinary work starts in a configured not-started status and recurring work in draft; creation directly into completed is unavailable.
- **Q04 — Workflow presets (resolved)**: Ordinary work follows idea → planning → ready → in_progress → sanity_check → done. The in_progress status means in progress; sanity_check means review. All five adjacent backward moves are allowed, as are done → in_progress, any unfinished status → cancelled, and cancelled → idea. Idea is initial. The first three states mean not started. Blocked is an indicator derived from prerequisites rather than another status. Recurring work starts in draft; draft may activate or archive, active may pause or archive, paused may activate or archive, and archived restores to paused. Each project selects one paused status for recurring restoration when it has several custom labels. Archival conditions always apply.
- **Q05 — Confirmation and categories (resolved)**: Only review → done requires approval by default, configurable for individual moves. Each new approval-required operation needs an assertion and the user's nonempty approval text; an identical retry remains the same operation. Human confirmation also records explicit consent text. No arbitrary custom conditions are included beyond the agreed dependency, stale-data, approval and lifecycle rules. Completed and cancelled work leave current workload views; completion history includes completed work and cancellation remains filterable.
- **Q06 — Migration semantics (resolved)**: Renaming preserves identity and task association. Removing values or changing priority models requires explicit mappings with no guessed conversion. Changes to category meanings validate the complete resulting affected state. Check prerequisites when an ordinary task's status or category changes into in progress, review or completed. Unchanged advanced dependents may remain in place when a prerequisite leaves completed, including across projects; do not reject or rewind them for that alone. Label, color, allowed-move and priority-only edits are not status moves. Other validity rules continue to apply, and historical meanings remain readable.
- **Q07 — Recurring lifecycle (resolved)**: Maintenance and recurrence use the same task kind. A pause skips newly arising periods while preserving existing occurrences and all obligations owed before pause. Archive first accounts for every owed active-period occurrence, then rejects any pending or owed occurrence. Project archival validates every child, preserves task states and makes the project read-only. Project restoration puts formerly active recurring children into the configured paused status as a recorded administrative effect without their ordinary move approvals, while preserving draft, already paused, individually archived and ordinary-task states. Calendar resume uses the next future scheduled time. Completion-relative resume preserves open occurrences; without one, an elapsed candidate requires an explicitly supplied new first deadline. Later deadlines continue from actual completion plus the interval.
- **Q08 — Occurrence mechanics (resolved)**: A confirmation window ranges from zero to 30 days. A mark recorded at or before deadline plus window is timely; expiry applies strictly later. Actual completion may be in the past but not future, and completion-relative actual times cannot move backward within one schedule. Occurrences may be pending, completed, completed late, owed, missed or cancelled. Expired work becomes owed or missed according to policy; pending, owed and missed work may complete, retaining an earlier miss. Completed occurrences cannot reopen. Only future pending occurrences of a paused parent may be cancelled, with a reason; owed work cannot. A recorded miss in completion-relative work waits for actual completion before another deadline. Automatic processing accounts for elapsed active periods after reopening and during use, and can also be requested explicitly. Its processing schedule is defined in the plan. Catch-up never duplicates work. Changed settings affect only occurrences not already created.
- **Q09 — Schedule and display (resolved)**: Supply the first deadline. Calendar schedules allow positive whole intervals up to 3,650 days, weeks or months, selected weekdays and a chosen month day clamped to month end. Completion-relative intervals allow positive whole hours or days up to 3,650. Activation creates the first occurrence; calendar processing includes all due active-period occurrences and one next future occurrence, preserving earlier ones. Overlapping windows and debts are allowed. Replacing a calendar schedule needs a new first deadline and retains its old occurrences. Changing timing mode requires no pending or owed occurrences and a new first deadline. A daylight-saving gap shifts a calendar occurrence forward by the gap; a repeated clock time uses the earlier occurrence. The parent's displayed deadline is its earliest pending or owed occurrence and cannot be edited independently.
- **Q10 — Time contract (resolved)**: Accept exact date and time with an explicit timezone offset and at most millisecond precision. Reject date-only input. A person entering a repeated or nonexistent local time must choose an unambiguous time or offset. Past ordinary and first deadlines are allowed. Completion-relative days are elapsed 24-hour periods; calendar days preserve local clock time. Changing application timezone preserves existing deadline instants; future calendar occurrences follow the same local rule in the new zone, with the change recorded in history. There is no separate scheduled-for field.
- **Q11 — Views and metrics (resolved)**: Active lists normally exclude archived, cancelled and completed work, with explicit filters to include it. Search ignores letter case and matches text within titles and descriptions. Filter by project, kind, status or category, priority, emoji and archive state. Pages contain 50 items by default, at most 200. A paged view uses one application-selected reference time; passing time alone does not invalidate it. Changed data or filters require a refresh, and a fresh view captures a new reference time. Users cannot supply a replacement clock. Agenda order is overdue, today, next seven calendar days, later, no deadline, grouped by project. Show recurring parents once at their earliest open deadline. Separate ordinary unfinished, overdue and completed counts from occurrence outcomes. Workload date filters use deadlines; completion filters use the recording time. Ranges include their start and exclude their end; omitted bounds are open-ended, equal bounds empty and reversed bounds invalid. Dated ranges exclude undated records, while unrestricted workload counts may include them. Each statistics request uses one reference time. Cancelled and archived work is excluded unless requested.
- **Q12 — Lifecycle, links, emoji and limits (resolved)**: Archive and restore preserve ordinary statuses and continue to enforce prerequisites and marker reservations. No deletion, moving between projects or slug renaming. Users may add and remove prerequisites and explicitly change task or project emoji, subject to the same validation and reservation rules. Archived completed prerequisites satisfy dependencies; archived unfinished ones do not. Adding an unmet prerequisite to advanced work is rejected. One emoji may include joined characters or skin-tone variants; visually equivalent presentation forms share a reservation while their displayed text is preserved. Current and past project markers remain reserved to their original project even when a restored backup lacks that project. Restoration rejects conflicting ownership rather than releasing reservations or rewriting history. Draft, active and paused recurring parents reserve task markers; completing one occurrence does not release its parent marker. Emoji search may return several tasks; changes use stable task identifiers. Limits are project slug 1–64 lowercase English letters, digits or hyphens; title 1–300 characters; description at most 100,000; names 1–80; and at most 100 statuses, 100 named levels and 100 prerequisites per task. Transfer limits are defined in the planning contracts.
- **Q13 — Description (resolved)**: Support Markdown paragraphs, emphasis, headings, lists, links and fenced code. Descriptions must not execute embedded content or unsafe links; images are not displayed. People edit the source; both interfaces preserve it exactly. No mandatory headings, attachments or rich editor. Save the whole description with stale-edit protection. Each occurrence retains the description and safe display it had when created.
- **Q14 — Audit access (resolved)**: Both interfaces browse immutable before-and-after history, including confirmation text and original workflow and priority meanings. Automatic recurrence is distinguishable from assistant commands and does not invoke an AI model. A separate history export is excluded.
- **Q15 — Access and origins (resolved)**: There are no accounts or login. People manage work through the human interface; hosting requirements are defined in the plan. Requests initiated by unrelated websites must not change work. These protections do not identify users or create identity-based permissions. External assistants use the command interface rather than direct third-party web access.
- **Q16 — Interface coverage (resolved)**: Every agreed operation is available to humans and assistants. Exact command and web contracts are defined in the linked contracts. Assistant changes to global settings identify an explicit project for actor attribution, and global restoration names all affected projects. A separate public third-party web interface or token integration is excluded.
- **Q17 — Offline (resolved)**: After a successful online opening, saved application pages, tasks, priorities and loaded descriptions can reopen offline. All writes and queues remain disabled. Show last refresh and missing information. Reconnection retains unsaved drafts while fetching current information. Restoration invalidates stale saved views but never discards draft text. Browser storage can be evicted; explain missing data instead of promising backup durability.
- **Q18 — Conflicts and retries (resolved)**: Protect changes against stale entity, configuration, dependency and timezone information, including a pre-restore application state. An identical successful retry returns its original result before ordinary stale-edit rejection, but old pre-restore requests always fail. Reusing a request for different content fails. Keep proposed descriptions locally for review and retry; no hidden shared draft service or automatic merge. Successful retry history has no time-based expiry in this release.
- **Q19 — Operations (resolved)**: Provide manual full backup and restore, with no cloud destination or automatic schedule. In maintenance mode, validate the backup, preserve a recovery copy, combine readable history and permanent project-marker reservations, and publish one complete restored state. Refuse conflicts or unreadable current history. Maintenance status remains visible. Acceptance and larger diagnostic workloads are defined in the plan. Performance targets require the plan's reproducible measurements and are not guessed service guarantees. The recoverable backup point is the last verified manual backup; power loss may lose recent acknowledged changes.

## Interface Scope

People use the mobile interface and external assistants use the non-interactive command
interface. Both expose all agreed user operations and the same project, approval and
conflict rules. The application supports the mobile interface; a separate public automation
service is excluded. Exact technical interfaces are documented in the
[planning contracts](contracts/), and human interactions in the
[mobile interaction contract](contracts/web-ui.md).

## Required Verification

These are observable acceptance obligations. The plan's verification matrix and detailed
verification requirements define the mandatory test mechanisms, tools and execution budgets.

- **VT-01 — Domain behavior**: Exercise all priority models, project workflows, approvals, configuration replacements, historical meanings, dependencies, exact deadlines, recurrence combinations, pauses, archive and restore, preserved occurrence descriptions and selected debt completion. Check time boundaries using reproducible inputs.
- **VT-02 — Change coverage**: For each change, verify the intended result and history, invalid-input rejection, project ownership where applicable, stale-edit rejection, safe retries and failure without partial changes. New project creation checks the requested slug and uniqueness instead of ownership of a nonexistent project. Reads and backup creation leave work and history unchanged; restoration has separate administrative coverage. The plan explains any other inapplicable cases.
- **VT-03 — Saved work and upgrades**: Verify that saved work and history survive reopening and supported upgrades. Preserve populated earlier versions when one exists; the first release explicitly records the absence of a previous released version.
- **VT-04 — Simultaneous work**: Demonstrate that truly overlapping changes either succeed completely or report a controlled conflict, with no lost or duplicated successful work or history. Cover competing marker choices, dependency changes, recurrence processing and restoration. Verify both successful waiting and exhausted waiting.
- **VT-05 — Interface agreement**: Verify every agreed operation through both user interfaces, including successful results, invalid input, errors, scope, ordering, time handling, stale edits and retries. Assistant operations remain non-interactive and failures distinguishable.
- **VT-06 — Mobile and offline use**: Verify the 430px maximum width, 44px touch targets, full operation coverage, copyable markers, faithful and safe description display, retained draft text, offline reopening, missing or evicted saved information, disabled offline changes, reconnection and refresh after restoration. Confirm that unrelated websites cannot initiate changes and no login or Telegram connection is required.
- **VT-07 — Release readiness**: Provide evidence that installation and the release's required engineering checks succeed on the supported deployment. Preserve ownership of work and history, privacy protections and recovery behavior. Planning and documentation reviews do not count as evidence of a working application.
- **VT-08 — Measurement honesty**: Report what was checked, its result, duration and limitations. Keep correctness checks, simultaneous-use checks and performance measurements distinct. Claims about speed or delivery size require the reproducible methods and limits in the plan; unavailable checks remain explicitly outstanding.
- **VT-09 — Dependencies**: Cover same-project and cross-project prerequisites, multiple prerequisites, custom status names, cancelled and archived cases, rejected self-links and circles, adding unmet prerequisites to advanced work, reopening a prerequisite without rewinding its dependents, complete configuration replacements and rejected recurring endpoints.
- **VT-10 — Emoji behavior**: Verify valid single markers, equivalent presentation forms, within-project uniqueness and release, repeatable ⚪, meaningful selection, permanent project reservations, return conflicts and complete rollback after competing assignments.
- **VT-11 — Edits and recovery**: Cover stale edits in either order, including edits to different text, preserved proposals and no silent merge. Recheck configuration and dependencies when saving. A retry after a lost response cannot repeat a successful change. Backups during ordinary use, blocked or interrupted restoration, combined readable history, permanent marker reservations, obsolete-request rejection and refreshed offline information must preserve the agreed recovery outcomes.

## Key Entities

- **Project**: A separately configured body of work with a stable slug, reserved emoji, project priority, workflow, task-priority model and archive state.
- **Priority and Workflow Configuration**: A project's meanings, ordered choices, allowed moves and approval requirements, with past meanings retained in history.
- **Task**: Ordinary or recurring work belonging to one project, with a stable identifier, emoji, title, description, priority, status and applicable deadline.
- **Dependency**: An ordinary task's prerequisite, including one in another project. Self-links and circular prerequisites are invalid.
- **Recurring Schedule**: A parent's chosen timing, first deadline, miss policy, confirmation window and active or paused periods, retaining older schedules when changed.
- **Occurrence**: One repetition with its original deadline, conditions and description, outcome, actual completion time and time the completion was recorded.
- **Audit Record**: An immutable history entry showing actor, origin, time, before-and-after values and any approval, retaining its meaning when configuration changes or backups are restored.
- **Saved Operation Result**: The outcome of a successful request, retained so repeating it does not repeat its effects.
- **Application Settings**: Shared timezone and operational settings, with changes checked against information read before a restore or configuration change.
- **Offline Copy and Local Draft**: Previously loaded information for disconnected reading and separately retained unsaved text. Neither is a queue of offline changes.
- **Backup and Recovery Record**: A verified full backup, its compatibility information and the progress of a restoration, allowing the previous state to be recovered after interruption.

## Success Criteria

These are release acceptance targets, not claims that functionality has been implemented or tested.

- **SC-001**: All four priority models coexist with independent project workflows, preserving exact numeric choices, unset priorities and the agreed project-first ordering.
- **SC-002**: Every allowed default forward, backward, cancel and reopen action respects project rules, except explicitly mapped configuration replacements. Every approval-required change retains the user's approval text.
- **SC-003**: Deadline entry and display preserve exact times. Tests cover optional deadlines, exact overdue and confirmation-window boundaries, month end and daylight-saving changes. No separate scheduled-for field is available.
- **SC-004**: Every successful tested change has immutable before-and-after history. Every rejected mapping, dependency change or conflicting edit leaves work and history unchanged. Configuration changes preserve the meaning of earlier history.
- **SC-005**: Every agreed operation produces equivalent outcomes through the human and assistant interfaces, with explicit scope, distinguishable results and failures, and safe retries after a lost response.
- **SC-006**: Every tested mobile screen has one centered column no wider than 430px, touch targets at least 44px and access to all agreed operations.
- **SC-007**: Previously loaded application pages, work and descriptions reopen offline. Missing information is explained, writes stay disabled and reconnection or restoration preserves unsaved drafts.
- **SC-008**: Descriptions preserve their submitted Markdown without mandatory headings. Assistant content stays inside them, occurrence descriptions retain their original text and stale saves cannot erase newer edits.
- **SC-009**: Recurrence acceptance cases cover all four timing and miss-policy combinations, active-period catch-up exactly once, no paused-period obligations, exact windows, late completion, preserved original conditions and completion of only selected debts.
- **SC-010**: Connected users can perform the release's read and write operations without credentials. Unrelated websites cannot initiate changes. No Telegram login or identity-based permissions are introduced.
- **SC-011**: Dependency acceptance cases reject circles and recurring endpoints, enforce completed prerequisites across projects and preserve dependent status when a prerequisite changes.
- **SC-012**: Emoji acceptance cases demonstrate exclusive permanent project markers, release of task markers, repeatable ⚪, meaningful selection and copying and pasting as ordinary text.
- **SC-013**: Verified manual restoration retains readable history from both versions and the previous recovery copy, makes one complete restored state available, rejects obsolete requests and preserves recovery options at tested interruption points.

## Assumptions and Scope

- [Constitution v3.0.0](../../.specify/memory/constitution.md) is binding. The user authorized moving technical documentation obligations to planning; all required engineering checks remain mandatory.
- User-selected decisions remain authoritative. Additional product defaults are recorded as delegated decisions. No product clarification is intentionally deferred.
- This correction changes documentation, not application behavior. The implementation backlog and all executable acceptance checks remain outstanding.
- The operator makes the application available through the supported setup documented in the plan. Offline reopening is supported after a successful online opening; this does not introduce login.
- Human-facing copy is Russian; repository documents and protocol names are English.
