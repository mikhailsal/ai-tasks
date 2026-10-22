# Research and delegated decisions

Date: 2026-10-21. Research supports a design, not a claim of installed dependencies or passing
application tests. The user authorized the agent to resolve all remaining product choices.
Round-seven A choices are preserved in Clarification history below; the current settled
defaults are recorded in [spec.md](spec.md).
Two independent research passes covered storage/recovery and browser/runtime choices; the
primary agent reconciled their findings with the constitution and final contracts.

## 1. Runtime and packaging

**Decision:** Node24.22.0 LTS, npm11.19.1, TypeScript with the constitution's strict flags.
Pin runtime/package manager in bootstrap configuration and commit the package lock. Build
CLI/server/worker entries with tsup; native better-sqlite3 remains external. Linux local
filesystem is the supported first-release host.

**Rationale:** The official release index identifies these exact runtime/package-manager
versions. One runtime reduces native-module and timezone differences across CLI/API/worker.
[Node release index](https://nodejs.org/dist/index.json),
[Node downloads](https://nodejs.org/en/download).

**Alternatives:** Bun was constitutionally allowed but adds native-runtime validation breadth;
Node26 Current is not needed. Package-library patch versions will be resolved and locked by
the bootstrap implementation task, with native engine compatibility tested; they are not
unresolved product questions.

## 2. SQLite writes and concurrency

**Decision:** better-sqlite3 + Drizzle synchronous immediate transactions; configure WAL,
foreign_keys=ON, synchronous=NORMAL and busy_timeout5000 on every file connection. Require
bundled SQLite>=3.51.3 and verify with `sqlite_version()`. Keep foreign requests/filesystem
awaits outside database transactions.

**Rationale:** SQLite permits one writer; immediate transactions acquire the write reservation
before dependent validation. Drizzle exposes SQLite transaction behavior and the adapter
uses synchronous better-sqlite3 transactions. The SQLite WAL documentation records a
concurrent WAL reset bug fixed in3.51.3; version verification is relevant to this app's
multiple independent CLI/API connections. [SQLite transactions](https://www.sqlite.org/lang_transaction.html),
[Drizzle transactions](https://orm.drizzle.team/docs/transactions),
[Drizzle better-sqlite3 adapter](https://raw.githubusercontent.com/drizzle-team/drizzle-orm/main/drizzle-orm/src/better-sqlite3/session.ts),
[SQLite WAL documentation](https://www.sqlite.org/wal.html).

**Alternatives:** No network database, custom ORM layer, async transaction callback or
application-wide single-process assumption. NORMAL follows the constitution; acknowledged
writes can be lost on power failure, so do not promise zero-loss power durability.
[SQLite synchronous settings](https://www.sqlite.org/pragma.html#pragma_synchronous).

## 3. Revisions and mutation receipts

**Decision:** Expected entity/configuration revisions, database epoch, operation UUID,
canonical fingerprint and saved result in the same transaction as mutation/audit. A receipt
lookup precedes ordinary stale-revision checks, but follows current-epoch validation.
Identical retry replays; changed content with same key conflicts. Every field is protected,
not only the description.

**Rationale:** This follows the user's delegated option A and the previously selected stale
text protection while addressing lost CLI/API responses. Epoch avoids revision-number reuse
following restore. Persistent receipts work across processes/restarts.

**Alternatives:** Last-write-wins, browser-only deduplication and auto text merging would
contradict settled behavior. Full CRDT/event sourcing would add unnecessary product scope.

## 4. Calendar time and recurrence snapshots

**Decision:** Server-only @js-temporal/polyfill for calendar arithmetic; native Intl display.
Immutable occurrence snapshots plus generation/anchor uniqueness and active/pause intervals.
A compiled CLI worker runs shared core commands with ai-cli:<project_slug> and
origin=recurrence-worker, startup/ticks every30 seconds; reads never reconcile state.

**Rationale:** Calendar days/month-end and DST differ from elapsed durations. Temporal
provides timezone-aware arithmetic and explicit ambiguity choices; the polyfill keeps this
complexity out of the browser bundle. New outcomes derive from recorded time and captured
window, while actual time only anchors completion-relative work.
[Temporal ZonedDateTime](https://tc39.es/proposal-temporal/docs/zoneddatetime.html),
[Temporal polyfill](https://github.com/js-temporal/temporal-polyfill).

**Alternatives:** A hand-written timezone offset engine is fragile; a browser polyfill spends
client budget on server-owned rules. A `system` audit actor would violate the current allowed
actor forms, and an LLM scheduler would violate the standalone state-engine boundary.

**Boundary decision:** Explicit restart after an elapsed completion-relative pause uses a
new first deadline/generation, never fake completion or retroactive paused debt. Calendar
catch-up is bounded per transaction but eventually covers every owed active-period anchor.

## 5. Offline shell, cached queries and drafts

**Decision:** React/Vite/Tailwind, TanStack Query with persistence to IndexedDB via a small
custom persister backed by idb-keyval. A generated service worker precaches shell/assets;
API query snapshots are owned by Query persistence, not a second opaque HTTP cache. Persist
only successful reads, never mutations. Cache identity includes epoch and schema. Keep drafts
separate from refreshed query state. Cache data has no artificial time expiration in the
first release, but browser eviction/quota failures are handled as missing-cache states.

**Rationale:** Offline reopening needs both executable shell and data, as the constitution
explicitly requires. Query persistence documentation explains hydration/garbage-collection
coordination; gcTime/maxAge are aligned so cache is not prematurely lost. HTTPS or localhost
is required for service workers. [TanStack persistence](https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient),
[Vite PWA](https://github.com/vite-pwa/vite-plugin-pwa),
[React application tooling](https://react.dev/learn/build-a-react-app-from-scratch),
[Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite).

**Alternatives:** localStorage is unsuitable for many100k-character descriptions; caching
only data cannot reopen the app. An offline mutation queue contradicts the requirement.

## 6. Markdown and small browser budget

**Decision:** Store raw free-form Markdown and render a restricted CommonMark subset on the
server using marked plus sanitize-html. Disable raw HTML and images; sanitize allowed tags,
attributes and http/https/mailto links. Cache the safe rendering alongside source for offline
viewing. Browser edits source; online preview calls a pure rendering query. Offline preview
shows source until the server can render safely. Version rendering policy and recompute safe
HTML from stored source when sanitizer rules change; original source snapshots stay immutable.

**Rationale:** Marked explicitly does not sanitize its result; a sanitizer is mandatory.
Both parser/sanitizer stay out of the150000-byte browser JS budget. No arbitrary HTML reaches
the UI from task text or a restored backup; validate/regenerate rendered caches on restore.
[Marked project](https://github.com/markedjs/marked),
[sanitize-html allowlist controls](https://github.com/apostrophecms/sanitize-html).

**Alternatives:** react-markdown is a viable safe renderer, but its browser parser dependency
cost competes with the full mobile admin UI. Lazy-loading alone does not solve a sum-of-all-
chunks budget. No syntax highlighter, rich-text framework, remote images or raw HTML plugin.

## 7. Emoji are references, not identity

**Decision:** One semantic RGI emoji grapheme selected externally; repeatable ⚪ task default.
Use server validation based on pinned emoji-regex RGI data and Intl.Segmenter, preserving
Unicode display while normalizing presentation selectors for comparison. Reserve project
markers globally for that project's lifetime/history and task markers only within active
project task scope. Technical IDs remain UUIDs and explicit project slugs are mandatory.

**Rationale:** Emoji sequences can contain several code points; string length is not a
validator. A pinned recognizer gives deterministic accepted vocabulary. RGI sequence support
must be tested against the selected package export rather than assumed from a broad emoji
code-point regexp. [emoji-regex project](https://github.com/mathiasbynens/emoji-regex).

**Alternatives:** Random assignment violates the user's semantic requirement; using emoji as
primary key or mutation selector is ambiguous after reuse. Huge browser picker libraries are
unnecessary: native text input/paste and recent user-selected symbols suffice.

## 8. Backup and restore without destroying audit

**Decision:** Online SQLite backup to a temporary file with bounded completion deadline,
integrity/checksum verification and atomic manifest publication. Restore uses a maintenance
supervisor, lifetime shared external connection locks, and exclusive restore lock. Stage the
backup, validate/migrate, union readable audit UUID records without changing existing fields,
union permanent live/backup project-emoji reservations with original slug ownership and reject
conflicting owners/staged marker collisions before publication, append restore provenance,
issue new epoch, keep recovery copy and atomically replace only
when all connections are closed. Status comes from an external job manifest.

**Rationale:** Copying a live .db file misses WAL state, and replacing an open database is
unsafe. Online backup may restart under writes by other connections, so its invocation time
is not promised as its exact content timestamp. Linux flock releases locks when owning file
descriptors close; the stable lockfile is never unlinked. [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md),
[SQLite corruption guidance](https://www.sqlite.org/howtocorrupt.html),
[Linux flock command](https://man7.org/linux/man-pages/man1/flock.1.html),
[Linux flock lifecycle](https://man7.org/linux/man-pages/man2/flock.2.html).

**Alternatives:** Plain live-file copying, SQL BEGIN EXCLUSIVE without process coordination,
PID-only locks, dropping current audit to match an old backup, and normal restore over
unreadable audit are rejected. Emergency forensic salvage is outside this release, not an
unrecorded destructive fallback.

## 9. Browser access boundary

**Decision:** One same-origin unauthenticated UI/API, exact configured Host/Origin allowlist,
JSON and custom mutation header for writes, reject cross-site fetch metadata, no wildcard
CORS. External automation uses explicit-scope CLI; no new external HTTP actor. Backup paths
are managed IDs, not arbitrary filesystem paths supplied by the browser.

**Rationale:** These are request-origin checks rather than identity permissions and preserve
'anyone who can connect' access while avoiding accidental cross-site mutations. Domain
confirmation text is audit evidence, not proof of authentication. Use Fastify hooks and test
with inject plus real-browser fetch. No external network sharing or telemetry is needed.

**Alternatives:** Adding login/Telegram/token accounts contradicts current release scope.
Binding Fastify publicly contradicts the constitution; external TLS routing remains operator-
owned and outside this repository.

## Dependency justification and implementation pinning

| Dependency/tool | Purpose | Cost and containment |
|---|---|---|
| better-sqlite3 + Drizzle/drizzle-kit | synchronous real SQLite, typed schema/migrations | native build/prebuild compatibility and migration review; pin exact versions at bootstrap, verify bundled SQLite>=3.51.3 |
| Zod + Commander + Fastify | thin validated adapters and deterministic contracts | schema/CLI/API upgrade tests; no backend runtime imports into browser |
| React, Vite, Tailwind plugin, TanStack Query/persist | constitution-mandated UI/data state | main browser baseline; measure actual emitted gzip, no icon/UI suite |
| idb-keyval | small IndexedDB persister/drafts primitive | small browser dependency; handle eviction/schema upgrades, no mutation persistence |
| vite-plugin-pwa/Workbox build tools | reproducible shell precache and SW | generated SW counts toward JS budget; explicit cache update tests |
| @js-temporal/polyfill | robust calendar/DST domain time | server-only polyfill and transitive bigint helper; no browser import |
| marked + sanitize-html | Markdown conversion plus allowlist sanitization | server-only parser/sanitizer updates and XSS regression tests |
| emoji-regex RGI data | deterministic Unicode emoji validation | server-only data, pinned vocabulary; test multi-code-point forms |
| Vitest, Playwright, ESLint, typescript-eslint, Prettier, tsup | actual behavior tests, lint/type/build | development dependencies; no production payload cost |
| Linux util-linux flock | cross-process maintenance connection lifetime gate | OS prerequisite, documented supervised process tree; crash/inheritance tests |

Exact library patches are pinned in package-lock.json by the implementation bootstrap, after
compatibility checks. No lockfile or package installation is fabricated by planning. The
runtime pin is already selected. No constitution exception or unresolved design question is
needed for this dependency set.

## Clarification history

Moved from the specification during the 2026-10-21 content correction. These are historical
questions and answers, including superseded unresolved wording. The current product decisions
are Q01–Q19 in [spec.md](spec.md); the detailed engineering decisions remain in the plan and contracts.

### Session 2026-10-20

- Q: Who can use the application in the current release, and how is access controlled? → A: Anyone who can connect to the application may use it without authentication. Telegram authentication is planned for a future version and is outside the current release.
- Q: How should a combined task list be ordered when projects use different task-priority models? → A: Group tasks by project and order tasks within each group using that project's task-priority model. Projects also have priorities relative to one another, which determine the order of project groups.

### Session 2026-10-21

- Q: How should priorities of projects themselves be represented? → A: Each project has a numeric priority. Larger numbers mean higher project priority, and multiple projects may have the same value.
- Q: What priority should a new project receive, and how should equal project priorities be ordered? → A: A new project defaults to numeric priority 0. Projects with equal priority are ordered alphabetically by their unique slug.
- Q: How should recurring work represent repetitions and handle missed occurrences? → A: Recurring work needs a dedicated flow with two missed-occurrence policies: carry forward as an outstanding obligation that must still be completed, or record the miss without a make-up obligation. Morning sets of five push-ups illustrate the latter; utility payments illustrate the former. Use one persistent recurring task with separate occurrence records inside it. Each occurrence has its own exact deadline and outcome: completed, missed, or outstanding debt; repetitions are not standalone tasks.

- Q: What determines the deadline of the next recurring occurrence? → A: Each recurring task can choose either a fixed calendar schedule or an interval after actual completion. Late completion does not shift a calendar schedule; in completion-relative mode, the next deadline is calculated from the actual completion time plus the configured interval.
- Q: When should an uncompleted recurring occurrence become outstanding debt or be recorded as missed? → A: Each recurring task has a configurable confirmation window after its deadline. Completion marked within that window counts as on time. If completion has not been marked when the window expires, the system automatically considers the occurrence uncompleted and applies its carry-forward or record-miss policy.

- Q: Does the missed-occurrence policy change how recurrence deadlines are calculated? → A: No. Recurrence timing and missed-occurrence policy are independent settings. A task may recur on a fixed calendar cadence, such as every 10 days, or 10 days after actual completion, regardless of whether misses become debt or are recorded without a make-up obligation. In completion-relative mode, no next deadline is assigned until actual completion occurs; this also applies after a recorded miss. Once completion occurs, the next deadline is actual completion time plus the configured interval.

- Q: How should completion be recorded when a calendar-based recurring task has several outstanding debts? → A: The user explicitly selects one or more occurrence records to mark as completed. Only the selected occurrences are completed; other debts remain outstanding.

- Q: What baseline lifecycle states should the persistent recurring task use? → A: Use draft for preparation, active for ongoing recurrence, paused for suspension, and archived for retirement with history preserved. This baseline supports further project-level workflow customization. Parent-task lifecycle states are separate from occurrence outcomes.

- Q: How should projects define allowed transitions between task statuses? → A: Each project explicitly configures directed transitions between specific statuses. A task can change status only through a configured transition; backward moves, shortcuts, and reopening are supported when the corresponding transition is configured.

- Q: How should the system interpret custom statuses of ordinary tasks across projects? → A: Each ordinary-task status maps to exactly one shared category: not started, in progress, review, completed, or cancelled. Multiple project-specific statuses may map to the same category, while projects retain custom status names and counts. These categories apply to ordinary tasks, not to recurring parent lifecycles or occurrence outcomes.

- Q: What happens to existing tasks when a project configuration change makes their status or priority values invalid? → A: Require explicit mappings from affected old values to valid new values. Apply the configuration change and all affected task updates atomically in one operation, preserving history. Reject the change when mappings are incomplete or invalid.

- Q: Should transitions out of review require human confirmation? → A: Each project configures which specific workflow transitions require human confirmation. This is a per-transition workflow requirement, not a universal requirement for every project or every review status. An agent can obtain the user's confirmation in conversation and perform the transition itself; how that confirmation is communicated to the application remains to be clarified.

- Q: How may an agent execute a transition that requires human confirmation in the unauthenticated release? → A: The agent may perform the change itself after obtaining the user's confirmation, including confirmation received in conversation. The user does not have to confirm or execute the transition through the Web UI. Domain validation and project-configured confirmation requirements still apply. How the application receives and records that externally obtained confirmation remains unresolved.

- Q: Which task-priority models should the first release support? → A: Provide classic levels ordered critical > high > normal > low, and an Eisenhower Matrix with independent yes/no importance and urgency flags. Custom schemes support either project-defined ordered named levels or a numeric scale with a project-defined range and direction (higher or lower values are more important). Custom multi-dimensional schemes and calculated priority formulas are outside this release.

- Q: What default priority model, unset-priority behavior, and within-project ordering should the release use? → A: New projects default to the classic model. Task priority is optional and unset by default; tasks with unset priority follow all tasks with assigned priority within their project. Eisenhower order is important and urgent, important and not urgent, urgent and not important, then neither. Within a project, sort by priority, earliest deadline (missing deadlines last), oldest creation time, then ascending task ID.

- Q: Which deadline and timezone rules apply across projects? → A: Ordinary-task deadlines are optional and may be changed or removed. An ordinary task is overdue only after its deadline has passed and its status category is neither completed nor cancelled. All projects use one configurable application timezone, defaulting to Europe/Moscow, for deadline input and calendar recurrence. Global views display times in that application timezone. Recurring occurrence confirmation-window rules remain unchanged.

- Q: Which additional task capabilities belong in the first release? → A: Include dependencies between tasks. Subtasks, tags, and attachments are outside the first release. Dependency behavior still requires clarification.

- Q: How should dependencies between ordinary tasks work? → A: Dependencies may connect tasks within or across projects. A dependency is satisfied only when its prerequisite task is in the completed category; cancellation does not satisfy it. While any prerequisite is not completed, transitions of the dependent task into in progress, review, or completed categories are blocked. Self-dependencies and dependency cycles are forbidden. Dependencies do not automatically change task statuses.

- Additional user clarification: Tasks need an emoji marker as a conspicuous human-facing visual reference that can be copied and pasted directly into an ordinary text field, including a Telegram message. It is not the technical task identifier. Assignment and editing rules remain unresolved; uniqueness and reuse are defined by the subsequent clarification below; this requirement does not add Telegram authentication or integration to the current release.

- Additional user clarification: Emoji markers should preferably be unique within a project; the subsequent clarification below defines enforcement and reuse.

- Q: How strictly should emoji uniqueness be enforced within a project? → A: Reject duplicate emoji markers among unfinished, non-archived tasks in the same project. Completion, cancellation, or archival releases the marker for reuse by another task. Reopening or restoration collisions and assignment behavior remain to be clarified.

- Q: How should task emoji be assigned on creation and when reopening or restoration encounters a collision? → A: A human or external AI selects a meaningful emoji; random assignment is unsuitable. When a selected emoji is occupied, request a different choice wherever the interaction supports doing so. If a reopening/restoration flow cannot support that choice, use an empty/default marker instead. The default marker is repeatable and may also be used for draft ideas; its representation is specified by the subsequent clarification below.

- Additional user clarification: Projects also need emoji markers. Project emoji must be globally unique among projects and must not be used by tasks in any project.

- Q: What should the empty/default task marker look like? → A: Use the shared repeatable emoji ⚪. It is a visible text marker, not an absent value or a randomly selected emoji.

- Q: What format and internal structure should task descriptions use for context, AI explanations, and plans? → A: Use free-form Markdown. Headings and structure are optional; no Context, AI Explanation, Plan, or other named sections are mandatory. AI explanations and plans remain inside the description.

- Q: What should happen when a human or agent saves a description that another participant has changed since it was read? → A: Reject the stale save without overwriting the current description. Retain the proposed edit for a retry after reading the latest text. Do not automatically merge changes or accept a last-write-wins overwrite.

- Clarification process override: The user requests only high-impact questions and permits up to 10 questions per round presented together. This supersedes the skill's five-question and one-at-a-time limits. Group related product decisions; leave implementation methods for planning. Unanswered product decisions remain explicit clarification markers, not assumed defaults.

- Q: Which project and task lifecycle operations belong in the first release? → A: Support archival and restoration of projects and tasks. Exclude permanent deletion, cross-project task moves, and changes to project slugs.

- Q: How must an agent communicate externally obtained user confirmation? → A: For the specific operation, the agent must provide both an explicit confirmation assertion and the text of the user's confirmation. Record both in audit history; a bare assertion is insufficient.

- Q: What happens to recurring obligations during a pause? → A: No new occurrences arise for periods during the pause. Existing occurrences, outstanding debts, and confirmation windows continue under their existing rules. Periods skipped because of the pause are not caught up on resume.

- Q: Which occurrences are affected by changes to recurrence settings? → A: Changes to the schedule, missed-occurrence policy, or confirmation window affect only future occurrences. Already created occurrences retain their existing conditions.

- Q: May actual completion time differ from the time completion is recorded? → A: Yes. The user or agent may provide a past actual completion time, defaulting to now when omitted. Completion-relative deadlines are calculated from that actual time, while the timeliness of the completion mark is still determined by the confirmation window.

- Q: Which recurrence patterns and initial-deadline rules are required? → A: Explicitly supply the first deadline. Calendar recurrence supports every N days or weeks, selected weekdays, and every N months on a specified day of the month. If that day does not exist in a month, use the last day of that month. Completion-relative intervals support hours and days.

- Q: May dependencies involve recurring tasks or their occurrences? → A: No. In the first release, dependency endpoints must both be ordinary tasks. Recurring parent tasks and occurrence records are excluded.

- Q: How fully must the mobile UI cover application management and audit access? → A: All agreed user operations must be available in both the Web UI and CLI, including project settings, workflows, priority models, recurrence, dependencies, archival/restoration, and audit browsing. Audit history shows before and after values. A separate audit-export feature is outside this release.

- Q: Must previously loaded data remain available after offline reload or reopening? → A: Yes. After a prior successful online opening, the application must reopen offline with saved data, including previously loaded descriptions. Writes remain disabled. On reconnection, refresh data while preserving unsaved text.

- Q: Is an explicit old-to-new status mapping sufficient to move tasks during a project configuration migration without ordinary workflow transitions? → A: Yes. Apply the explicit mapping without requiring ordinary workflow edges or their transition confirmations. Dependency checks remain mandatory. Preserve the old values and their meanings in history. Other mapping validation, project scoping, atomicity, and audit requirements still apply.

### Delegated decisions — 2026-10-21

The user explicitly instructed the agent to answer all remaining questions and proceed to planning. This supersedes the earlier instruction to leave unresolved choices for another interactive clarification round. The following are agent-selected decisions under that authorization, not answers individually supplied by the user. Earlier clarification entries are historical; the consolidated requirements below are the current contract.

- Round 7, question 1 — A: Archive projects or recurring tasks only when no pending occurrences or debts remain; use pause while obligations remain. Archive hides work from active views, stops future recurrence, preserves history, and prevents ordinary editing until restoration.
- Round 7, question 2 — A: Provide the ordinary forward chain, adjacent backward transitions, done → in_progress, cancellation from unfinished statuses, and cancelled → idea. Default initial status is idea; sanity_check → done requires confirmation. The first three statuses are not_started, followed by in_progress, review, and completed; cancelled maps to cancelled.
- Round 7, question 3 — A: Recurrence and maintenance use one recurring kind. Start in draft, use active and paused, and restore archived recurring work to paused. Custom recurring statuses map to these four lifecycle behaviors.
- Round 7, question 4 — A: Require explicit missed-occurrence policy and confirmation-window duration. A zero window is valid; a mark at exactly deadline plus window is timely, and expiry applies strictly afterwards.
- Round 7, question 5 — A: Permit late completion of both debts and recorded misses, producing completed_late while retaining the original miss in audit history. Actual completion drives the next completion-relative deadline.
- Round 7, question 6 — A: Reconstruct all calendar occurrences owed during service downtime, without duplicates, excluding intentionally paused periods. Completion-relative recurrence never invents completion timestamps.
- Round 7, question 7 — A: Provide overdue, today, next seven days, later, and no-deadline views, agreed list ordering, search and filters, and separate task/occurrence workload counts.
- Round 7, question 8 — A: Each occurrence snapshots its description on creation; later parent edits do not rewrite it.
- Round 7, question 9 — A: Protect all entity/configuration-dependent mutations against stale versions. Replaying the same operation after a lost response returns its original result without duplicate state changes or audit records.
- Round 7, question 10 — A: Provide manual full backup/restore through UI and CLI; exclude cloud backup and automatic backup scheduling.
- Remaining choices: The resolved decision register Q01–Q19 below supplies the defaults, boundary rules, interface scope, and operational assumptions needed for planning. No unresolved product decision remains intentionally deferred to the user.
