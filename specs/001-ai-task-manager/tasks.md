# Tasks: Complete AI Task Manager

**Feature**: `001-ai-task-manager` | **Date**: 2026-10-21 | **Git branch**: `main`

**Inputs**: [specification](spec.md), [implementation plan](plan.md), [research](research.md), [data model](data-model.md), [common contract](contracts/common.md), [CLI contract](contracts/cli.md), [HTTP contract](contracts/http.md), [mobile UI contract](contracts/web-ui.md), [quickstart](quickstart.md), and [constitution v3.0.0](../../.specify/memory/constitution.md).

All six user stories are P1. US5 precedes US4 in execution because agenda, ordering, and workload need real occurrence state. Story numbers retain their specification identities. All six stories and the final release checks are required; the first demonstrable slice is US1.

Constitution v3.0.0 recheck: the amendment relocates technical specification content to the
plan/contracts and puts mutation applicability in the plan verification matrix. This task
generation preserves all 107 task IDs and their story/test owners, makes worker query
prerequisites explicit, and carries forward the engineering constraints from every design artifact.

This is an implementation backlog, not completed implementation or test evidence. Every path below is relative to the repository root. New module names refine the directories approved in the plan. Product behavior remains defined by the linked specification and contracts; no new product decisions are deferred.

**Execution rules**: Setup and foundation test-authoring tasks may complete with execution explicitly pending on the migrations/entries they exercise; no missing import or executable counts as a behavior-test result. T021 must run and pass the foundational checks before any story work. A task may start only when its explicit prerequisites and phase entry gate are complete. `[P]` marks a disjoint-file wave, not unrestricted parallel execution. Each wave joins before the next wave. Story test tasks come first: author them and observe a relevant failing assertion before implementing the behavior, then make them pass at the story checkpoint. Do not accept a broken test harness or missing executable as sufficient red evidence.

**Mandatory mutation matrix**: For every domain command implemented below, its owning integration/contract test must cover committed state plus immutable audit and receipt; applicable validation; wrong-project ownership for existing project-owned targets; stale entity/config/settings revisions and epoch; exact replay versus changed-payload conflict; and rollback with no partial state or success audit. Use production migrations and real SQLite, never mocked core/DB. Project creation tests explicit slug/uniqueness instead of nonexistent-target ownership. Queries prove no state/audit/receipt changes. Backup creation is operational and domain-read-only; restore has its own administrative matrix. Record any other N/A with justification in the verification matrix in `specs/001-ai-task-manager/plan.md` before dependent implementation, and link that rationale from `tests/mutation-coverage.md`.

## Phase 1: Setup — toolchain and verification commands

**Goal**: Create the pinned single-package application scaffold and meaningful test harnesses.

**Independent verification**: A clean npm install, toolchain configuration checks, formatting, native SQLite availability/version smoke, and fixture/process-barrier scaffolding work on the declared Linux runtime. Initial migrations, compiled application entries and a running migrated-database harness are completed and exercised at T014–T021, not required to close Setup. Unavailable application commands remain explicitly pending until T021.

- [X] T001 Initialize `package.json`, `package-lock.json`, `.node-version`, and `.npmrc` for Node `24.22.0` / npm `11.19.1`; pin compatible dependency versions from `research.md`, including better-sqlite3/Drizzle, Zod, Commander, Fastify, React/Vite/Tailwind/TanStack, server-only Temporal/marked/sanitize-html/emoji-regex, the selected persistence/PWA tooling, and Prettier development formatting; verify native installation without adding an LLM or Telegram client, moment, or lodash. (No prerequisites.)

- [X] T002 [P] Configure strict TypeScript and architectural lint in `tsconfig.json`, `web/tsconfig.json`, `eslint.config.js`, and `.prettierrc.json`: configure Prettier and `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, no any/ignore/expect-error/non-null assertions or moment/lodash imports; infer types from Drizzle/Zod, reject import cycles; `schema <- core <- cli/api`, browser-safe imports only, runtime orchestration without SQL, plain functions except custom errors. Enforce plan limits: application complexity12/depth4/parameters4/function100/module400; React150/complexity15; tests250-case/700-module/complexity20; generated migration size exemption only. (Depends on T001.)

- [X] T003 [P] Configure compiled entries in `tsup.config.ts` and browser/Tailwind/PWA-capable scaffold in `web/vite.config.ts`, `web/index.html`, and `web/src/app/styles.css`; externalize native SQLite from server bundles, exclude server parsers/polyfill from browser imports, set development 127.0.0.1:5173 and `/api` proxy to 127.0.0.1:3000, and create output directories described in `plan.md`. (Depends on T001.)

- [X] T004 [P] Create `vitest.config.ts`, `playwright.config.ts`, `tests/fixtures/database.ts`, `tests/fixtures/clock.ts`, and `tests/fixtures/process-barrier.ts`: scaffolding for real temporary migrated file databases, injected clocks, compiled subprocess/IPC barriers, and Chromium/WebKit production browser harness; author fixture contracts now, defer execution against production migrations/entries until T014–T021; budget functional cases10s, contention cases30s/job180s, browser cases30s/job10min, benchmarks5min, with cleanup and no domain-time sleeps. (Depends on T001.)

- [X] T005 Wire `db:migrate`, `typecheck`, `lint`, `test:functional`, `test:contention`, `test:e2e`, `build`, `check:bundle-size`, `bench`, `start`, `dev`, and `format:check` in `package.json`; create the initial emitted-browser-JavaScript inventory and gzip-level9 check in `scripts/check-bundle-size.mjs` so builds can measure the strictly-below150000-byte budget from bootstrap onward (T103 hardens its accounting); add bounded runner in `scripts/run-suite.mjs` and command/exit/duration evidence format in `tests/README.md`. Keep functional, real contention, browser, and benchmark commands separate; no universal three-second gate or Git-hook bypass. (Depends on T002, T003, T004.)

**Checkpoint**: Toolchain and harness prerequisites exist; feature behavior tests are still expected to fail until their implementation waves.

---

## Phase 2: Foundation — shared storage, mutation protocol, and adapters

**Goal**: Establish storage and the invariant-preserving command boundary used by every story.

**Independent verification**: Connection/migration, ownership/receipt/audit, maintenance lock, transport boundary, and shell smoke tests pass on real files; no domain query is hidden in an adapter.

### Tests first

- [X] T006 [P] Add `tests/integration/database.test.ts` for initial migration, reopen, UUID/FK/check/unique constraints, indexes, WAL/NORMAL/foreign_keys/busy_timeout, SQLite version refusal, immutable audit/config snapshots, no live-entity FK on history, and permanent project-emoji reservations surviving without a live owner-project FK. Record prior-release populated migration testing as N/A for schema v1, with future-fixture policy in `tests/fixtures/migrations/README.md`. (Depends on T005.)

- [X] T007 [P] Add `tests/integration/mutation-protocol.test.ts` and initialize `tests/mutation-coverage.md` for epoch-before-replay, canonical key-order-independent hashing, receipt-before-stale-revision replay, changed actor/scope/body conflict, scope checks, injected clock, atomic rollback/audit/receipt, and settings/config/entity revision guards on real transactions. (Depends on T005.)

- [X] T008 [P] Add `tests/contention/lifetime-lock.test.ts` for independent processes holding shared connection-lifetime locks, exclusive restore wait/refusal, crash release, stable lockfile identity, and inherited-FD closure; synchronize with IPC barriers and bounded deadlines, never same-thread Promise.all or PID-file guessing. (Depends on T005.)

### Implementation

- [X] T009 [P] Define `application_state`, `projects`, `project_configs`, `tasks`, and emoji reservation tables in `src/schema/entities.ts`; use UUID text, checked boolean integers, validated JSON, positive integer revisions, exact-thousandths numeric priority storage, immutable unique project slug, `(project_slug,id)` ownership key, timezone default `Europe/Moscow`, and `read_revision`. Permanent project-emoji reservations retain their original slug owner without a live-project FK so restore can preserve absent-project history. Preserve raw Markdown plus server-rendered HTML; recurring deadline is derived, with no `scheduled_for` field. (Depends on T006, T007, T008.)

- [X] T010 [P] Define dependency, schedule generation, checkpoint, half-open active/paused/archived interval, and occurrence tables in `src/schema/recurrence.ts` and `src/schema/dependencies.ts`; enforce ordinary endpoint ownership FKs, unique `(generation_id,occurrence_key)`, frozen rule/policy/window/description snapshots, six occurrence states, positive revisions, nullable actual/recorded/missed/cancel fields, and indexes for deadline/expiry/cursor scans from `data-model.md`. (Depends on T006, T007, T008.)

- [X] T011 [P] Define `audit_records` and `operation_receipts` in `src/schema/history.ts`: immutable UUID audit events without a live project/entity FK, original semantic before/after/config/confirmation snapshots, and receipt PK `(database_epoch,operation_id)` with hash, actor/scope/operation, original result/audit IDs/time. Keep receipt retention unbounded and recovery manifests outside domain tables. (Depends on T006, T007, T008.)

- [X] T012 [P] Implement browser-safe value/envelope Zod schemas in `src/schema/values.ts` and `src/schema/envelopes.ts`. Quote/enforce: slugs `[a-z0-9]+(?:-[a-z0-9]+)*`, "at most 64 characters"; titles "1–300 characters after surrounding whitespace is trimmed"; descriptions "at most 100,000 Unicode code points" with source preserved; names/labels "1–80 characters"; UUID technical IDs, stable ASCII config keys, snake_case/unknown-key rejection, omitted unchanged/null only nullable, JSON bodies "at most 1 MiB (except backup transfer)". (Depends on T006, T007, T008.)

- [X] T013 [P] Implement Linux util-linux flock child wrappers in `src/runtime/database-lock.ts` and `src/runtime/locked-entry.ts`; acquire shared lock before every app-owned SQLite connection, hold for its entire lifetime, never unlink the stable lockfile, expose exclusive helper mode, close inherited shared descriptors, and propagate bounded failures/signals without logging payloads. No SQL/domain behavior belongs in runtime. (Depends on T006, T007, T008.)

- [X] T014 Assemble exports in `src/schema/index.ts`, configure `drizzle.config.ts`, and generate reviewed initial migration in `drizzle/0000_initial.sql` plus Drizzle metadata; implement connection/migration functions in `src/core/database/open.ts` and `src/core/database/migrate.ts`. Assert SQLite `>=3.51.3`, `foreign_keys=ON`, file `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`; require lock ownership and refuse unresolved recovery manifests before normal opens. (Depends on T009, T010, T011, T012, T013.)

- [X] T015 [P] Implement domain/custom error functions and the exact error-to-HTTP/CLI mappings in `src/core/errors.ts` and `src/schema/errors.ts` from `contracts/common.md`, including stable baseline codes, revision/config/epoch/idempotency/dependency/emoji/confirmation errors, MAINTENANCE, CURSOR_STALE and ORIGIN_REJECTED; expose structured safe details/retryability, never SQL, paths, stack traces, or caller-selected actor identity. (Depends on T014.)

- [X] T016 [P] Implement precise time parsing/serialization and injected-clock context in `src/core/time.ts` and `src/core/context.ts`: integer Unix milliseconds, RFC3339 "with a required offset and millisecond precision or coarser", UTC `YYYY-MM-DDTHH:mm:ss.SSSZ`, reject date-only/offset-free/submillisecond values, permit past instants, and keep user-local resolution distinct from generated DST rules. (Depends on T014.)

- [X] T017 Implement plain synchronous immediate-transaction command execution in `src/core/database/mutate.ts`, canonical fingerprints/receipts in `src/core/audit/receipts.ts`, and audit append in `src/core/audit/append.ts`: current epoch before replay; exact original result before stale-token rejection; explicit ownership/config/settings/entity checks; state+reservations+revisions+read_revision+audit+receipt atomic; rollback on failure and busy exhaustion => DB_CONFLICT. Actors are only `human-web` or `ai-cli:<slug>`; worker adds origin `recurrence-worker`. (Depends on T015, T016.)

- [X] T018 [P] Build Commander entry/envelope/input modules in `src/cli/main.ts`, `src/cli/io.ts`, and `src/cli/context.ts`; support `--json` on every command, one newline-terminated success stdout envelope, failure JSON stderr/nonzero using contracted codes, `--input <file|->` without rewriting input, EOF-safe stdin, duplicate flag/body rejection, explicit `--project` versus read-only `--all-projects`, operation/epoch/revision flags, and fixed scoped CLI actors. (Depends on T017.)

- [X] T019 [P] Build Fastify supervisor transport in `src/api/app.ts`, `src/api/security.ts`, and validated helper dispatch in `src/api/data-helper.ts`; supervisor owns no DB/shared lock, helper invokes core under shared lifetime lock. Bind 127.0.0.1, enforce exact Host including port, reject cross-site Fetch Metadata when supplied as required by `research.md` §9, exact configured Origin + JSON + `X-AI-Tasks-Mutation: 1` on POST/PATCH/PUT including pure preview requests, 1MiB limit, safe errors/CSP/no-store, no wildcard CORS/accounts/authentication; use explicitly configured development proxy origin only in dev. (Depends on T017.)

- [X] T020 [P] Create `web/src/app/App.tsx`, `web/src/app/router.tsx`, `web/src/components/Field.tsx`, `web/src/components/Button.tsx`, and `web/src/data/api.ts`: Russian UI copy, single centered `width:100%`/`max-width:430px` column, touch targets at least44px, labels/focus/non-color indicators, schema-derived browser-safe types and guarded mutation envelopes; no server/runtime imports or internal AI generation. (Depends on T017.)

- [X] T021 Complete bootstrap boundary tests in `tests/contracts/bootstrap.test.ts` and `tests/e2e/shell.spec.ts`; run foundation tests/typecheck/lint/build through `tests/README.md`, checking the now-working migrated temporary database harness, compiled CLI, helper startup/shutdown, native SQLite, safe envelopes, no-auth access, host/origin/cross-site Fetch Metadata failures, preliminary bundle measurement, and mobile shell. Close the pending Setup execution checks here. Record actual commands/durations and resolve failures before story work. (Depends on T018, T019, T020.)

**Checkpoint**: All shared foundation tests pass. Subsequent story commands reuse this kernel and infrastructure rather than duplicating domain rules.

---

## Phase 3: User Story 1 — Capture and advance work (P1; first demonstrable slice)

**Goal**: Create projects and ordinary tasks, preserve descriptions, and advance configured work with reliable scope and conflicts.

**Independent verification**: From an empty migrated DB, create a project and ordinary task through CLI and mobile UI, edit Markdown/deadline/emoji, traverse forward/back/cancel/reopen paths, confirm completion, reject stale saves, and archive/restore with unchanged history.

### Tests first

- [X] T022 [P] [US1] Add `tests/integration/ordinary-work.test.ts` for project/task create/edit/archive/restore, default and supplied ProjectConfigInput on creation (all four priority models/custom workflows), invalid supplied config rolling back project/reservations/audit/receipt, configured initial status, all default edges including done→sanity_check, confirmation text, nullable deadline/priority, whole Markdown round trips, actor/ownership/audit/rollback/replay matrix, human-first and agent-first stale/disjoint-text conflicts, and ordinary overdue strict boundary. (Depends on T021.)

- [X] T023 [P] [US1] Add `tests/integration/emoji.test.ts` and `tests/unit/markdown.test.ts`: RGI/ZWJ/tone/flag and invalid text, NFC/variation selectors, repeatable ⚪, per-project active reservation/release/return, create/update collision returning EMOJI_CONFLICT without fallback or state/audit changes, permanent project history reservations versus all stored tasks; hostile Markdown/raw HTML/images/dangerous URLs never execute while original source remains exact; rendering-policy upgrades rebuild safe HTML from unchanged raw task/occurrence source without rewriting immutable audit. (Depends on T021.)

- [X] T024 [P] [US1] Add `tests/contracts/ordinary-work.test.ts` and `tests/e2e/ordinary-work.spec.ts` for project/task/description and config preset/read routes and compiled commands, project creation with default/supplied/invalid config through CLI/HTTP and built-in preset selection in the US1 UI (custom configuration editor browser coverage belongs to T038), create/edit emoji conflicts retained for correction, 430px forms, precise local time input, explicit transition consent, semantic emoji copy/paste, read-only archives, saved source/preview, and preserving proposed values on conflicts. Use real core and production browser assets. (Depends on T021.)

### Implementation

- [X] T025 [P] [US1] Implement `src/core/tasks/emoji.ts`: require "exactly one RGI emoji grapheme" with pinned recognizer and Intl.Segmenter, NFC display, comparison removes only U+FE0E/U+FE0F; preserve ZWJ/modifiers/regional indicators. ⚪ repeats only on tasks; reserve nondefault ordinary unfinished/unarchived and recurring draft/active/paused parents; permanent global current/former project markers reject any stored task match. Assignment/release/return is transaction-bound; only reopening/restoration collisions fall back to ⚪ in noninteractive return paths unless explicit reject; create/edit collisions fail with EMOJI_CONFLICT, project markers never fall back, and assignment is never random. (Depends on T022, T023, T024.)

- [X] T026 [P] [US1] Implement server-only `src/core/markdown/render.ts` and `src/core/markdown/preview.ts` using marked + sanitize-html: CommonMark paragraphs/emphasis/headings/lists/links/fenced code, raw HTML/images disabled, safe URL policy, source unchanged up to100000 Unicode code points, sanitized display-only output; version the rendering policy and rebuild derived safe HTML from preserved task/occurrence Markdown after policy changes, leaving source snapshots and audit immutable; preview is pure and no separate AI reasoning/plan fields exist. (Depends on T022, T023, T024.)

- [X] T027 [P] [US1] Implement `src/core/projects/presets.ts` and complete browser-safe ProjectConfigInput validators in `src/schema/configuration.ts` before project creation: all four priority models and their exact bounds/precision/count limits, distinct stable IDs, fixed color palette, ordinary/recurring categories, valid explicit edges, initial/restore status membership and required confirmation booleans from `contracts/common.md`; use these same validators in later configuration work. Supply stable category keys/default workflows: idea→planning→ready→in_progress→sanity_check→done, five adjacent backward edges, done→in_progress, unfinished→cancelled, cancelled→idea; only sanity_check→done confirmed by default. Include recurring draft/active/paused/archived preset and restore_status_id=paused; creation accepts only configured initial not_started/draft status. (Depends on T022, T023, T024.)

- [X] T028 [US1] Implement scoped project create/get/list/edit and ordinary-member archive/restore in `src/core/projects/commands.ts` and `src/core/queries/projects.ts`; implement pure scoped preset/config-get queries in `src/core/queries/configuration.ts`, returning the persisted current configuration and config revision without state/audit/receipt changes. Enforce immutable slug, explicit nondefault semantic emoji, default classic config or fully validated supplied ProjectConfigInput with atomic initial config snapshot, "signed 32-bit integers, default `0`, never null" project priority, title/name/description limits, no delete/rename/move; require complete `affected_tasks` revisions for project archive/restore, preserve child state/history/reservations, archived project reads only. US5 extends these same atomic handlers for recurring children before release. (Depends on T025, T026, T027.)

- [X] T029 [US1] Implement ordinary task create/get/list/update/archive/restore and transitions in `src/core/tasks/commands.ts` and `src/core/tasks/transitions.ts`: UUID identity, selected/default emoji, model-compatible nullable priority, optional removable exact deadline, whole raw description/rendered snapshot replacement, configured initial/edges/categories, source/target-scoped `{asserted:true,user_text:nonempty}` confirmation, reservation changes and atomic audit. Derive overdue as now>deadline outside completed/cancelled; preserve status on archive, forbid hard delete/move, and validate existing dependency rows at advanced transitions. (Depends on T028.)

- [X] T030 [P] [US1] Register config presets/get, project CRUD/archive/restore with optional supplied config on create, ordinary task CRUD/transition/archive/restore, and pure description preview commands in `src/cli/commands/projects.ts`, `src/cli/commands/tasks.ts`, `src/cli/commands/descriptions.ts`, and the initial read-only `src/cli/commands/configuration.ts`, matching `contracts/cli.md`; forward complete revision sets, confirmation and emoji collision options to core, preserve exact same-operation result on retry. (Depends on T029.)

- [X] T031 [P] [US1] Register config presets/get, project/task CRUD (including supplied project config), transition/archive/restore, and description preview routes in `src/api/routes/projects.ts`, `src/api/routes/tasks.ts`, `src/api/routes/descriptions.ts`, and the initial read-only `src/api/routes/configuration.ts`, matching `contracts/http.md`; bind scope from route, keep actor human-web, return create201/other200 and original status on exact replay, with no duplicated validation rules. (Depends on T029.)

- [X] T032 [P] [US1] Implement `web/src/screens/Projects.tsx` and `web/src/components/EmojiField.tsx`: active/archived lists, explicit All projects, create/edit numeric project priority and required meaningful emoji, choose built-in priority/workflow presets on creation via config reads, immutable slug display, copyable markers, archive/restore with full child-revision payload and preserved permanent project marker (no collision-choice field); archived projects expose read/history/restore with mutation reasons. (Depends on T030, T031.)

- [X] T033 [P] [US1] Implement `web/src/screens/TaskDetail.tsx`, `web/src/components/MarkdownEditor.tsx`, and `web/src/components/DeadlineField.tsx`: ordinary create/detail/edit, model-aware nullable priority, source/server preview, precise date+time+zone, explicit fold offset/gap correction, configured transition/confirmation dialog, archive/return emoji choice. Add navigation to audit filtered by the current project/task (activated with the US3 audit screen). Display dependency blockers and status by category, never infer transitions from status ordering. (Depends on T030, T031.)

- [X] T034 [P] [US1] Implement separate browser draft records and operation proposals in `web/src/data/drafts.ts` and `web/src/components/ConflictReview.tsx`: retain text/fields/original base revisions on refetch or conflict, vertically compare current state, reconcile changed config without overwriting proposal; lost response retries identical immutable ID/body, changed proposal gets new ID; never auto-merge, autosave over stale state, or queue offline writes. (Depends on T030, T031.)

- [X] T035 [US1] Wire US1 modules in `src/cli/main.ts`, `src/api/app.ts`, `src/api/data-helper.ts`, and `web/src/app/router.tsx`; run US1 tests and complete the command rows in `tests/mutation-coverage.md`, including archived-task read-only rules, actual user confirmation in audit, safe Markdown, scope rejection, exact time and stale-proposal behavior. Record the ordinary-only demonstration in `tests/README.md`. (Depends on T032, T033, T034.)

**Checkpoint**: US1 is independently demonstrable with ordinary tasks. This is an incremental checkpoint, not delivery of the full requested product; recurring lifecycle extensions are explicitly owned by US5.

---

## Phase 4: User Story 2 — Configure projects and dependencies (P1)

**Goal**: Give each project independent priorities/workflows and safely migrate them while enforcing ordinary-task prerequisites.

**Independent verification**: Create four projects with distinct priority models/custom labels; preview and atomically migrate populated/archived ordinary tasks; create same- and cross-project dependencies, reject cycles and blocked transitions, and retain old semantic audit meaning.

### Tests first

- [X] T036 [P] [US2] Add `tests/integration/configuration.test.ts` for classic/Eisenhower/named/numeric schemas, exact precision/bounds/defaults, initial/restore status keys and configured edges, pure preview, complete mappings/revision sets including archived tasks, label-only no task revision rewrite, semantic snapshots, projected-state dependency/emoji validation, and atomic stale/invalid migration rollback. Prove changed status/category into an advanced category revalidates prerequisites, unchanged cross-project dependents may become blocked without moving/rejecting the migration, and label/color/edge/priority-only changes do not trigger that transition guard. (Depends on T035.)

- [X] T037 [P] [US2] Add `tests/integration/dependencies.test.ts` and `tests/contention/dependency-cycle.test.ts`: completed-only satisfaction across projects/custom labels, cancelled/archived cases, multi-prerequisite and100 limit, self/cycle/recurring-endpoint rejection, adding unmet edge to advanced task rejected, prerequisite reopening leaves dependent unchanged, final-state migration checks, and opposing edge writers under real process barriers. (Depends on T035.)

- [X] T038 [P] [US2] Add `tests/contracts/configuration-dependencies.test.ts` and `tests/e2e/configuration-dependencies.spec.ts` for presets/config read/preview/migrate and dependency list/add/remove parity, custom ProjectConfigInput creation through the Project screen with valid/invalid atomic outcomes, model-aware mobile forms, exact mappings, explicit source scope, confirmation customizations, collision/migration errors, and no partial changes through either adapter. (Depends on T035.)

### Implementation

- [X] T039 [P] [US2] Implement priority validation/ranking in `src/core/projects/priorities.ts`, reusing the creation schemas from T027 for input validation: classic critical/high/normal/low; Eisenhower independent important/urgent flags; named stable levels highest-first; numeric inclusive `[-1000000000,1000000000]`, "at most three decimal places", min<max, direction higher/lower, integer-thousandths exactness/no rounding; task null=unset. Enforce "100 named priority levels" and fixed palette slate/red/orange/amber/green/teal/blue/indigo/violet/rose. (Depends on T036, T037, T038.)

- [X] T040 [P] [US2] Implement workflow validation in `src/core/projects/workflows.ts`, reusing the creation schemas from T027 rather than introducing different create/migrate rules: "100 statuses per workflow", unique stable ASCII IDs, labels1–80, ordinary categories not_started/in_progress/review/completed/cancelled and recurring draft/active/paused/archived; one configured initial not_started/draft status, mandatory paused restore_status_id, valid explicit edges/confirmation flags, no arbitrary guard expressions or label-based semantics. (Depends on T036, T037, T038.)

- [X] T041 [P] [US2] Implement `src/core/tasks/dependencies.ts` and `src/core/queries/dependencies.ts` with max "100 prerequisites per task", ordinary endpoints only, explicit source ownership and independently checked target slug/ID, immediate-transaction cycle detection, completed-only satisfaction including archived completed prerequisites, add-to-advanced guard, audited removal without auto-transition, and commit-time blocker checks. (Depends on T036, T037, T038.)

- [X] T042 [US2] Implement pure preview and atomic migration in `src/core/projects/configuration.ts`: complete expected affected-task revisions and removed/invalid/meaning-changed mappings, duplicate/unknown/missing rejection, archived task inclusion only under active owning project, projected-state dependency/emoji validation: recheck prerequisite satisfaction for ordinary tasks whose status ID/category changes into in_progress/review/completed, preserve unchanged advanced dependents when their prerequisite is mapped out of completed, and skip satisfaction rechecks for label/color/edge/priority-only edits; structural graph invariants still apply globally. Preserve immutable old semantic snapshots, and edge/label/color-only revision semantics. Bypass only workflow edges/confirmation; retain scope/epoch/revisions/settings/lifecycle guards. Reject oversized atomic requests rather than silently splitting; US5 supplies recurring retirement/generation integration. (Depends on T039, T040, T041.)

- [X] T043 [P] [US2] Extend the existing presets/config reads with preview/migrate and implement dependency list/add/remove in `src/cli/commands/configuration.ts` and `src/cli/commands/dependencies.ts`; expose full mapping/affected revision input and read-only preview with the exact CLI contract, using the same core commands and fixed source actor. (Depends on T042.)

- [X] T044 [P] [US2] Extend the existing config preset/read routes with preview/migrate and implement dependency list/add/remove routes in `src/api/routes/configuration.ts` and `src/api/routes/dependencies.ts`; enforce preview-origin headers despite purity, return current config revision/validation issues, and preserve all-or-nothing core outcomes. (Depends on T042.)

- [X] T045 [P] [US2] Implement `web/src/screens/ProjectConfiguration.tsx`, `web/src/components/ConfigurationEditor.tsx`, and `web/src/components/PriorityField.tsx`: all four models, fixed color tokens with labels, workflows/categories/initial/restore status/edge consent, reuse the shared structured configuration editor in `web/src/screens/Projects.tsx` to supply custom ProjectConfigInput at project creation without raw JSON, pure preview, complete affected-task mapping forms and one explicit atomic commit; retain drafts on stale config and show historical meanings without requiring raw JSON editing. (Depends on T043, T044.)

- [X] T046 [P] [US2] Implement `web/src/screens/Dependencies.tsx`: same/cross-project ordinary target search/select, satisfaction and blocker display, add/remove with source project and revision tokens, cycle/advanced-state errors, links to prerequisite details, and no implied target mutation or status changes. (Depends on T043, T044.)

- [X] T047 [US2] Integrate configuration/dependency guards into `src/core/tasks/transitions.ts`, register adapters/navigation in `src/cli/main.ts`, `src/api/app.ts`, `src/api/data-helper.ts`, and `web/src/app/router.tsx`, and run US1+US2 regression cases; update `tests/mutation-coverage.md` with migration and graph mutations, real opposing-edge race evidence, and preserved immutable history. (Depends on T045, T046.)

**Checkpoint**: Ordinary work supports all project customization and dependency rules independently of the recurrence scheduler; later recurrence integration must retain these passing cases.

---

## Phase 5: User Story 3 — Use CLI/API and history (P1)

**Goal**: Make automation, HTTP delivery, operational startup, history and concurrency guarantees consistent across the implemented command surface.

**Independent verification**: Use compiled CLI and Fastify over identical migrated fixtures to compare resources/errors/audit, reject wrong scope and stale retries, browse semantic history, and prove actual independent-writer lock success/exhaustion.

### Tests first

- [X] T048 [P] [US3] Create `tests/contracts/command-matrix.test.ts` and `tests/fixtures/contract-matrix.ts` enumerating every command/route in `contracts/cli.md` and `contracts/http.md`, including later recurrence/read/recovery families with explicit owning-story readiness, not silent skips. Assert compiled dist subprocess stdout/stderr/exit/EOF/--json, scope flags, error mappings, status codes, UUID/time envelopes, confirmation actor evidence, original replay results, and query purity. (Depends on T047.)

- [X] T049 [P] [US3] Add `tests/contention/writes.test.ts` and `tests/contention/emoji-race.test.ts`: independent processes/connections with barriers test transient busy recovery, 5000ms busy exhaustion => DB_CONFLICT, no lost writes or duplicate receipts/audits, same-op races, stale descriptions/config tokens, and task/project marker collisions; keep domain clock tests separate from real bounded lock timing. (Depends on T047.)

- [X] T050 [P] [US3] Add `tests/integration/history.test.ts` and `tests/e2e/http-delivery.spec.ts` for paginated historical before/after/config meanings and confirmation evidence, task-detail audit links opening the matching project/entity filter, historical slug reads after missing entity, origin/Host/body limits and cross-site Fetch Metadata rejection with no state/audit writes, no-login access, development proxy, production deep-link fallback, unknown `/api` JSON404, safe errors/logs, and no secret telemetry. (Depends on T047.)

### Implementation

- [X] T051 [P] [US3] Implement pure history queries in `src/core/queries/audit.ts` with project/all/entity/operation filters, stable timestamp/ID pagination and captured config semantics, actor/origin/confirmation display data, and historical project slug reads even when absent from live projects. Never update existing events or require live entity FKs; no audit export feature. (Depends on T048, T049, T050.)

- [X] T052 [P] [US3] Implement shared pagination/fingerprint helpers in `src/core/queries/cursor.ts`: default50/max200, opaque cursors bind scope/filter/order version/database_epoch/read_revision and server-selected as_of; capture as_of on the first page and reuse it for all time-based classification, return meta.as_of separately from actual meta.now, reject caller clock overrides, and capture a new as_of only on a fresh first-page request. Time passing alone does not invalidate a session; changing read_revision or cursor context returns CURSOR_STALE and requires first-page refetch. Queries never tick, expire, audit, or mutate receipts. (Depends on T048, T049, T050.)

- [X] T053 [US3] Complete startup/meta/static delivery in `src/runtime/supervisor.ts`, `src/api/routes/meta.ts`, and `src/api/static.ts`: supervise long-lived locked API data helper, expose metadata, one compiled serve readiness JSON event followed by stderr operational diagnostics, production same-origin assets/deep-link fallback with `/api` JSON404, and separate maintenance-safe status plumbing. Keep supervisor free of SQLite; add recurrence child lifecycle in US5 and exclusive restore in US6. (Depends on T051, T052.)

- [X] T054 [P] [US3] Implement meta/serve/audit list and finalize common read filters in `src/cli/commands/meta.ts`, `src/cli/commands/serve.ts`, and `src/cli/commands/audit.ts`; honor AI_TASKS_DB_PATH/AI_TASKS_BACKUP_DIR, explicit project/all scopes, no prompts or caller-supplied actor, stable failure streams and contracted startup behavior, using compiled package bin `ai-tasks`. (Depends on T053.)

- [X] T055 [P] [US3] Implement audit read routes in `src/api/routes/audit.ts` and helper command dispatch typing in `src/api/dispatch.ts`; allow historical slug audit reads, keep current-project existence checks for writes, preserve original write HTTP status on exact replay, and use the core error table without leaking internal errors. (Depends on T053.)

- [X] T056 [P] [US3] Implement `web/src/screens/Audit.tsx` with project/aggregate/entity/operation filtering and pagination, actor/origin/time, field-by-field before/after values and original config meanings, and exact user consent context; wrap long content inside the430px column with accessible non-color labels. (Depends on T053.)

- [X] T057 [US3] Register operational/history modules in `src/cli/main.ts`, `src/api/app.ts`, `src/api/data-helper.ts`, and `web/src/app/router.tsx`; run completed command-matrix rows and real contention suites, record outcomes in `tests/mutation-coverage.md` and `tests/README.md`. Keep later-family rows visibly pending until their story gates; final release must have zero pending command/route pairs. (Depends on T054, T055, T056.)

**Checkpoint**: Automation/history/runtime contracts pass for implemented families. US5, US4 and US6 must fill the explicitly tracked remaining parity rows before final delivery.

---

## Phase 6: User Story 5 — Recurring and maintenance work (P1)

**Goal**: Implement versioned recurring parents and deterministic occurrences, independent timing mode/miss policy, retirement guards and shared timezone settings.

**Independent verification**: With an injected clock, exercise both miss policies across every calendar/after-completion pattern, expiry boundaries, downtime, pause/resume/restart, selected debt completion and project restore; identical concurrent ticks produce one obligation and no lost audit.

### Tests first

- [X] T058 [P] [US5] Add `tests/unit/calendar.test.ts` and `tests/integration/recurrence-generations.test.ts`: calendar days/weeks/weekdays/month-end/DST, after-completion24h days, explicit first seed, historical-generation late completion, active restart vs paused configuration vs timezone continuation, old-anchor reconciliation, same-parent deadline collision, snapshot immutability, and no invented actual completion. (Depends on T057.)

- [X] T059 [P] [US5] Add `tests/integration/occurrence-outcomes.test.ts`: both miss policies, window0/30day endpoints and strict expiry, completion actual versus recording time, worker-not-yet-run miss+late audit in one transaction, nondecreasing after-completion actual times, selected mixed batch ownership/revision/rollback, duplicate completion replay, future-only paused cancellation/reason, and debt cancellation refusal. (Depends on T057.)

- [X] T060 [P] [US5] Add `tests/integration/recurrence-lifecycle.test.ts` and `tests/contention/recurrence-race.test.ts`: bounded active downtime catch-up, pre-pause arrears still processed, no paused-period obligations, precreated future windows retained, calendar and elapsed completion-relative resume, all-child project archive/restore revisions, recurring configuration retirement, timezone settings conflicts, duplicate ticks and expiry/completion races via real process barriers. (Depends on T057.)

- [X] T061 [P] [US5] Add `tests/contracts/recurrence-settings.test.ts` and `tests/e2e/recurrence.spec.ts` for every recurrence/occurrence/settings command-route pair, explicit policy/window/first anchor forms, manual tick, per-row actual time, selected debt closure, paused cancellation reason, snapshot detail, configured lifecycle confirmations, and archive blockers without debt forgiveness. For direct recurring TaskRestore, test configured confirmation required/missing/incomplete/supplied through compiled CLI and HTTP/UI, checking no failed-write audit and the successful confirmation context; reject confirmation on an ordinary restore. (Depends on T057.)

### Implementation

- [X] T062 [P] [US5] Implement `src/schema/recurrence-input.ts`: required first_deadline/miss_policy/confirmation_window_ms with no policy/window default; policies `carry_forward`/`record_miss`, window inclusive `[0,2592000000]`, every integer `[1,3650]`, calendar days/weeks or distinct nonempty ISO weekdays `[1..7]` or months day `[1..31]`, local_time `HH:mm:ss.SSS`; after_completion unit hours/days independent of policy. Validate batch occurrence IDs/revisions/optional actual time, reject user-supplied derived parent deadline. (Depends on T058, T059, T060, T061.)

- [X] T063 [P] [US5] Implement server-only `src/core/recurrence/calendar.ts` and `src/core/recurrence/elapsed.ts` using Temporal: calendar weeks=7 local days, original month day retained with month-end clamp, generated fold chooses earlier instant/gap shifts forward, completion days=24 elapsed hours; explicit first anchor may be past on initial activation, computed successors require real actual completion, never scheduled_for. (Depends on T058, T059, T060, T061.)

- [X] T064 [US5] Implement `src/core/recurrence/generations.ts` and `src/core/recurrence/snapshots.ts`: immutable versioned schedule/zone/policy/window/description/render snapshots and mutable checkpoint separation; explicit initial seed, active restart requires future first_deadline and seeds now, paused generation never recreates paused periods, timezone continuation never historical-reseeds. Reconcile old owed anchors before changing generation; timing-mode switch requires no pending/debt and new first_deadline; reject same-parent existing deadline collision. (Depends on T062, T063.)

- [X] T065 [US5] Implement explicit scoped tick in `src/core/recurrence/tick.ts`: bounded resumable calendar enumeration through now plus one future anchor over half-open active intervals, including pre-pause arrears; skip newly paused anchors, preserve existing rows, dedupe `calendar:<anchor_instant>` and `after:<predecessor_occurrence_id>` keys, atomically update cursor/occurrences/audit/receipt. Add expiry in `src/core/recurrence/expire.ts`: when now>captured deadline+window, pending becomes debt or missed by captured policy with one miss audit, including existing paused-parent windows; exact endpoint stays pending. Use injected clock and current expected_settings_revision; reads never run this command. (Depends on T064.)

- [X] T066 [US5] Implement `src/core/recurrence/complete.ts` and `src/core/recurrence/cancel.ts`: pending/completed/completed_late/debt/missed/cancelled outcomes, timely recorded_at<=deadline+window and expiry strictly greater; actual<=now, nondecreasing in after-completion generation. Validate every selected ID/revision before writes; append missing logical miss before late completion, retain missed_at/audit, derive successor once/current generation only, classify one backdated successor without synthetic chain. Cancel only future pending `deadline>now` while parent paused with nonempty reason; never cancel debt. (Depends on T065.)

- [X] T067 [US5] Implement `src/core/recurrence/control.ts` and `src/core/recurrence/retirement.ts`: configured initial/lifecycle edges and confirmation, including optional TaskRestore.confirmation that becomes mandatory for a confirmation-required recurring restore edge (ordinary restore rejects that field), draft activation, pause/resume preserving open windows/debts, no paused-period catch-up; elapsed completion-relative candidate requires explicit future first_deadline/new generation on resume, calendar chooses next future anchor. Archive/retirement requires reconciled owed cursor through effective retirement and zero pending/debt including future precreated rows; missed history does not block. (Depends on T066.)

- [X] T068 [US5] Extend recurring create/update/transition/archive/restore in `src/core/tasks/commands.ts` and `src/core/tasks/transitions.ts`; recurring is the sole maintenance kind, one stable parent with occurrence history, no occurrence tasks/dependency endpoints, derived earliest pending/debt display deadline, immutable existing snapshots on parent description edit, settings revision guard, and parent emoji reservation independent of occurrence outcomes. (Depends on T067.)

- [X] T069 [US5] Extend `src/core/projects/configuration.ts` and `src/core/projects/commands.ts` atomically for recurring category mappings and project archive/restore: validate every child before hiding/read-locking, reconcile owed retirement anchors, preserve child states/reservations on archive, require exact complete affected_tasks revisions, restore formerly active children to configured paused restore_status_id without child edge/confirmation checks, preserve other states and audit every changed child. Stale/incomplete sets abort all changes; no automatic resume. (Depends on T068.)

- [X] T070 [US5] Implement pure settings read and scoped timezone mutation in `src/core/projects/settings.ts`: IANA zone default Europe/Moscow; explicit project attribution plus settings/config/epoch preconditions. Preserve all stored instants, reconcile historical arrears under old generation zone, version future calendar local rules strictly after prior anchor/effective change, increment relevant settings/read revisions, and enforce expected_settings_revision on recurring create/configure/control/complete/tick and timezone-affecting migrations. (Depends on T069.)

- [X] T071 [US5] Implement pure recurrence/occurrence get/list/detail projections in `src/core/queries/recurrence.ts` and core due-candidate discovery in `src/core/queries/due-work.ts`: current config/checkpoint and parent derived deadline, frozen description/render/schedule history, exact deadline/window/actual/recorded/missed/cancel fields, stable paginated outcomes, no expiry side effects, and batch parent associations without N+1 queries. (Depends on T070.)

- [X] T072 [US5] Implement `src/cli/commands/worker.ts` and `src/runtime/recurrence-worker.ts`: compiled explicit project worker, startup plus30-second ticks, locked own connection lifetime, call core due-work queries followed by scoped core commands with current tokens; runtime only orchestrates process/timer/lock and contains no database query or domain rule, actor ai-cli:<slug>/origin recurrence-worker; stale candidates re-read, bounded batches rescheduled without skipping arrears, one readiness JSON envelope and operational stderr, graceful drain/exit on maintenance. (Depends on T071.)

- [X] T073 [P] [US5] Implement recurrence get/configure/control/tick, occurrence list/get/complete/cancel and settings get/update in `src/cli/commands/recurrence.ts`, `src/cli/commands/occurrences.ts`, and `src/cli/commands/settings.ts`; enforce explicit parent/project, occurrence/settings revisions, selected batch body and confirmation; no prompts, implicit debt selection or invented deadline. (Depends on T071, T072.)

- [X] T074 [P] [US5] Implement contracted recurrence/occurrence routes in `src/api/routes/recurrence.ts`, `src/api/routes/occurrences.ts`, and scoped application-settings update in `src/api/routes/settings.ts`; dispatch only shared core functions, preserving atomic batch errors, source settings revision and read-only detail snapshots. (Depends on T071, T072.)

- [X] T075 [P] [US5] Implement `web/src/screens/Recurrence.tsx` and `web/src/components/RecurrenceFields.tsx`: independent timing mode/miss policy, explicit first exact deadline/window, calendar patterns and elapsed intervals, configured lifecycle controls/confirmation, explicit restart when required, manual process-due action, settings-conflict preservation, and retirement blockers linked to owed/pending/debt records. (Depends on T073, T074.)

- [X] T076 [P] [US5] Implement `web/src/screens/Occurrences.tsx` and `web/src/screens/Settings.tsx`: frozen occurrence instructions and outcome history, separate deadline/window/actual/recorded/miss displays, explicit single/batch selection and optional actual time per row, reasoned eligible cancellation; shared IANA timezone editing with project attribution and future-generation impact. (Depends on T073, T074.)

- [X] T077 [US5] Register recurrence/settings commands/routes/UI in `src/cli/main.ts`, `src/api/app.ts`, `src/api/data-helper.ts`, `web/src/app/router.tsx`, extend task creation screen for recurring input, and wire supervised workers in `src/runtime/supervisor.ts`; run recurrence/ordinary/config regression and real race suites, fill corresponding contract/mutation rows in `tests/fixtures/contract-matrix.ts` and `tests/mutation-coverage.md`. (Depends on T075, T076.)

**Checkpoint**: Real recurrence state now exists for every policy/mode; project/config lifecycle extensions and explicit settings guards pass before read-view implementation.

---

## Phase 7: User Story 4 — Review priorities, deadlines, and workload (P1)

**Goal**: Provide deterministic project-first lists, agendas and statistics across heterogeneous models and real occurrence data.

**Independent verification**: Populate four priority models and mixed ordinary/recurring states; compare CLI/API/UI ordered pages, agenda boundaries and separate counters against fixed expected results, including cursor invalidation under mutation.

### Tests first

- [X] T078 [P] [US4] Add `tests/integration/read-views.test.ts`, `tests/integration/query-plans.test.ts`, and `tests/integration/ordinary-completion-time.test.ts`: persisted ordinary completion recording, category-entry/configuration mapping, preservation/replay/rollback and unknown-time semantics; all priority models, unset/null/ties, signed project priorities, archived/terminal/custom categories, recurring parent single row, strict overdue and calendar buckets, literal search/filter semantics, stable pagination/CURSOR_STALE and query purity; advance injected time across an ordinary deadline and local midnight between pages without writes, require no row loss/duplication and a constant meta.as_of, and prove fresh first-page refresh reclassifies with a new instant; use EXPLAIN QUERY PLAN/query counts to reject N+1 relation lookups. (Depends on T077.)

- [X] T079 [P] [US4] Add `tests/contracts/read-views.test.ts` and `tests/e2e/read-views.spec.ts` for list/agenda/priorities/stats compiled CLI and HTTP parity, explicit project/all scope, filter/cursor binding, model context, empty results and grouped mobile cards, separate task/occurrence counters and date-range meanings; test half-open from<=timestamp<to, both single-sided ranges, equal bounds returning empty counts, reversed bounds rejected, and null metric timestamps excluded only with a supplied bound, with meta.as_of and no accepted caller clock override. (Depends on T077.)

### Implementation

- [X] T080 [US4] Implement project-aware lists/search in `src/core/queries/tasks.ts`: projects priority DESC then ASCII slug ASC; inside each project model rank set-before-unset, deadline ASC missing-last, created_at ASC, ID lexicographic ASC. Use classic/named/numeric semantics and Eisenhower order important+urgent, important+nonurgent, nonimportant+urgent, neither, without cross-model score; filters literal case-insensitive title/Markdown substring, scope/status/category/priority/kind/emoji, include_terminal and archive exclude/include/only. Page parents first, batch relations and earliest open occurrence; use shared revision-bound cursors. (Depends on T078, T079.)

- [X] T081 [P] [US4] Implement `src/core/queries/agenda.ts` and `src/core/queries/priorities.ts`: retain project grouping first; overdue/today/next7calendar days excluding today/later/no-deadline buckets disjoint in configured timezone, one recurring parent using earliest pending/debt deadline; preserve model context/flags/numeric direction/unset semantics without flattening heterogeneous priorities. (Depends on T080.)

- [X] T082 [P] [US4] Implement `src/core/queries/statistics.ts` and a versioned internal nullable `tasks.completion_recorded_at` fact with ordinary transition/configuration integration (set on entering completed, preserve while completed, clear on leaving; conservative old-history backfill): expose `tasks:{by_kind,by_category,total}` for parent task inventory, separate ordinary unfinished/overdue/completed counters, and `occurrences:{pending,debt,missed,completed,completed_late,cancelled,total}`; never inflate task workload with occurrences or add recurring parents again to occurrence workload; use deadline for workload from/to filters and completion-recorded time for completed counts, respecting scope/archive/terminal filters and the contract-specific timestamp field for each metric. Apply half-open [from,to), omitted bounds unbounded, from=to empty, from>to VALIDATION_ERROR, null timestamps excluded only with a bound; capture one server as_of per request and return it separately from meta.now. (Depends on T080.)

- [X] T083 [P] [US4] Implement agenda/priorities/stats and full task-list query flags in `src/cli/commands/views.ts` and `src/cli/commands/tasks.ts` exactly as `contracts/cli.md`; reject mixed project/all scopes and invalid model-filter values, return stable ordered envelopes with timezone/epoch metadata and cursor errors. (Depends on T081, T082.)

- [X] T084 [P] [US4] Implement agenda/priorities/stats routes in `src/api/routes/views.ts` and upgrade task-list route in `src/api/routes/tasks.ts`; keep handlers pure query adapters, apply contracted query validation and pagination caps, and never start recurrence or expiration on reads. (Depends on T081, T082.)

- [X] T085 [P] [US4] Implement `web/src/screens/Agenda.tsx` and `web/src/components/TaskCard.tsx`: project-priority groups and disjoint calendar sections, visible/copyable task/project emoji, ordinary versus derived recurring deadlines, filters/search/pagination, explicit terminal/archive state, CURSOR_STALE first-page refresh and no fabricated empty results; use/display server meta.as_of for bucket and overdue classification throughout pagination, separately from last refresh time, without reclassifying loaded rows by browser clock. (Depends on T083, T084.)

- [X] T086 [P] [US4] Implement `web/src/screens/Priorities.tsx` and `web/src/screens/Workload.tsx`: clear per-project model labels, Eisenhower flags/quadrants, named/classic/numeric/unset ordering, separate ordinary and occurrence counts, date-range controls explicitly labeling inclusive from/exclusive to and equal/reversed cases, and readable Russian labels within one430px column. (Depends on T083, T084.)

- [X] T087 [US4] Wire view modules in `src/cli/main.ts`, `src/api/app.ts`, `src/api/data-helper.ts`, and `web/src/app/router.tsx`; run read contract/browser/EXPLAIN fixtures against actual recurrence data, tune only justified indexes with versioned migration if needed, and record index/query-count evidence in `tests/query-plans.md` plus completed query-purity/parity rows. (Depends on T085, T086.)

**Checkpoint**: All lists, priority views, agendas and statistics use actual recurring state and produce identical deterministic results through both adapters.

---

## Phase 8: User Story 6 — Mobile/offline access and manual recovery (P1)

**Goal**: Complete all mobile operations, offline reopening, and maintenance-mode backup/restore that preserves history and drafts.

**Independent verification**: Reopen cached shell/details offline, demonstrate disabled writes/cache misses and preserved stale drafts; create/validate/restore a managed backup through CLI/UI while independent writers drain, verify audit union/new epoch, and recover deterministic crash failpoints.

### Tests first

- [X] T088 [P] [US6] Add `tests/e2e/offline.spec.ts` and `tests/e2e/mobile-coverage.spec.ts`: successful online load then cold offline reload/reopen, cached Markdown source/render, no artificial cache expiry across reopen beyond library default retention windows, uncached detail and storage eviction/quota, saved time indicator, all writes disabled/no queue, reconnect/flapping/lost response/CLI competing edit/new epoch with drafts retained; enumerate every UI operation and assert narrow/wide430px layout,44px targets, keyboard/wrapping and Russian copy. (Depends on T087.)

- [X] T089 [P] [US6] Add `tests/integration/backup.test.ts` and `tests/integration/restore.test.ts`: online snapshot under concurrent writers, external operation receipts with no domain backup audit, checksum/schema/integrity validation, exact live+backup affected-project union, null absent-live revisions, immutable audit UUID union/divergent collision, permanent project-emoji reservation union (including post-backup marker changes and owners absent from restored projects), rejection of divergent reservation owners or staged marker collisions with untouched current DB, continued collision rejection after restore, exact typed/sorted EMOJI_CONFLICT details from validation and helper (owner mismatch versus staged project/task collision), new epoch/old retry rejection, regenerated safe HTML, verified recovery copy, and corruption refusal preserving original bytes. (Depends on T087.)

- [X] T090 [P] [US6] Add `tests/contention/restore-lock.test.ts` and `tests/integration/restore-crash.test.ts` with real helpers/process barriers and named failure points before/after stage sync, manifest sync, atomic replacement, directory sync and reopen; prove no open-connection replace, no inherited-lock deadlock, maintenance status availability without DB, deterministic startup completion/rollback, and no interval with a missing live database. (Depends on T087.)

- [X] T091 [P] [US6] Add `tests/contracts/recovery.test.ts` and `tests/e2e/recovery.spec.ts` for every backup list/create/validate/restore/status command-route pair, durable lost-response status by operation ID, confirmation and every affected project revision, UI maintenance/new-epoch refresh, read-only archived scope, and browser-safe managed backup IDs rather than arbitrary paths. (Depends on T087.)

### Implementation

- [X] T092 [P] [US6] Implement `web/src/data/cache.ts` and `web/src/data/connectivity.ts` using TanStack Query persistence/idb-keyval: successful read snapshots and fetched source/rendered descriptions keyed by epoch/schema version/scope/filters/config/query shape, saved-at times, aligned persistence maxAge and query gcTime with no artificial time expiry in this release; distinguish that policy from best-effort browser storage with no durability promise, explicit quota/eviction/cache-miss state, offline mutation disable/no queue, reconnect metadata/config refresh while retaining separate dirty drafts/base tokens, epoch invalidation before any save. (Depends on T088, T089, T090, T091.)

- [X] T093 [P] [US6] Implement `web/src/sw.ts` and production service-worker setup in `web/vite.config.ts`: versioned application-shell precache with navigation fallback for offline reopen, no fabricated successful API response cache, compatible updates/reload, localhost-or-HTTPS behavior; ensure all emitted SW/lazy JavaScript remains counted in bundle budget. (Depends on T088, T089, T090, T091.)

- [X] T094 [P] [US6] Implement `src/core/recovery/backup.ts` and `src/core/recovery/manifests.ts`: managed IDs/paths, online SQLite backup to temporary file with bounded deadline under writes, checksum/integrity/schema/source-epoch/settings/project metadata, fsync then atomic publish, external receipts for create and read-only list/validate/status, including read-only validation EMOJI_CONFLICT with typed, deterministically sorted ReservationConflict details from the common contract, and no domain state/audit write. Do not claim invocation instant equals snapshot contents or copy unreconciled live DB/WAL. (Depends on T088, T089, T090, T091.)

- [X] T095 [US6] Implement `src/core/recovery/prepare.ts`: validate source backup and current readable audit, exact affected_projects=union(live,backup) with current entity/config revisions or null for absent-live, operation/epoch/settings/config and explicit confirmation; checkpoint/close under exclusive lock, create verified old recovery copy, stage/migrate supported schema, preserve all original audit rows byte-for-byte and add backup-only UUIDs, reject divergent UUID content, union permanent project_emoji_reservations by key and original slug owner (live row wins equal owner/key; backup-only rows retained), keep absent-project historical owners without a live-project FK, reject divergent owners or staged task/project marker conflicts with EMOJI_CONFLICT before publication, retain affected-project scope as the live+backup project-table union, append scoped restore events, issue new epoch and sanitize restored Markdown with current renderer. (Depends on T092, T093, T094.)

- [X] T096 [US6] Implement `src/core/recovery/publish.ts` and `src/core/recovery/recover.ts`: durable external old-epoch/operation job receipt, sync stage/recovery copy/phase manifest, one same-filesystem atomic replacement while connections are closed, directory fsync and integrity/pragmas/epoch reopen verification. Unfinished manifest blocks normal startup until exclusive deterministic finish/rollback; preserve damaged current bytes and refuse normal restore when full audit is unreadable, with no hidden destructive salvage path. (Depends on T095.)

- [X] T097 [US6] Implement `src/runtime/restore-helper.ts` and extend `src/runtime/supervisor.ts`: enter maintenance, drain accepted requests, stop API data helper and recurrence workers and release shared locks, spawn helper without inherited descriptors to acquire exclusive stable flock, publish/recover through core, restart only after verified generation; HTTP supervisor keeps status available without DB. External CLI connections obey same lock; bounded failure never guesses stale PIDs or replaces an open DB. (Depends on T096.)

- [X] T098 [P] [US6] Implement `src/cli/commands/backups.ts` for backup list/create/validate/restore/status, including status by job ID or operation ID, explicit write attribution/affected-project union and confirmation, external operational receipts, compiled helper launch, JSON-only readiness/results and stable MAINTENANCE/epoch errors; old-epoch restore replay cannot bypass validation. (Depends on T097.)

- [X] T099 [P] [US6] Implement `src/api/routes/backups.ts` and `src/api/routes/recovery-status.ts`: managed backup creation/list/validation, scoped restore202 job acceptance and durable status lookup without DB during maintenance, exact Host/Origin/mutation headers, no arbitrary browser filesystem paths, and original operational results on valid same-epoch retry. (Depends on T097.)

- [X] T100 [P] [US6] Implement `web/src/screens/Backups.tsx` and `web/src/components/RecoveryProgress.tsx`: manual list/create/validate, complete current+backup project union and revision review, explicit user-text confirmation, permanent project-marker conflict details that prevent restore rather than rewriting emoji, job progress/lost-response lookup during maintenance, recovery failure explanation, new-epoch data refresh with unsaved drafts retained; no cloud or scheduled backup. (Depends on T098, T099.)

- [X] T101 [P] [US6] Implement `web/src/components/OfflineBanner.tsx`, `web/src/components/CacheMiss.tsx`, and `web/src/app/MutationBoundary.tsx`: persistent offline/last-refresh context, cached read/detail views, explicit missing cache, disable every mutation including settings/config/manual tick/backups/restore, preserve drafts for reconciliation and show maintenance-safe job status without implying fresh API data. (Depends on T098, T099.)

- [X] T102 [US6] Integrate recovery/maintenance adapters and global cache guards in `src/cli/main.ts`, `src/api/app.ts`, `src/api/data-helper.ts`, `src/core/database/open.ts`, `web/src/app/App.tsx`, and `web/src/app/router.tsx`; verify every screen operation from `contracts/web-ui.md`, archived-state controls, full epoch reset/draft behavior, and all US6 browser/recovery/contention tests. Finish recovery rows in `tests/mutation-coverage.md` and `tests/fixtures/contract-matrix.ts`. (Depends on T100, T101.)

**Checkpoint**: All six user stories are implemented and independently exercised. Restore status remains reachable during maintenance, and no offline write or hidden loss of readable audit is accepted.

---

## Phase 9: Polish — release evidence and complete acceptance

**Goal**: Validate the complete product against every requirement and constitution obligation without treating measurement goals as proven speed guarantees.

**Independent verification**: All functional, contract, contention, browser, type/lint/build and bundle gates pass with real evidence; performance reports disclose environment and unmet goals; documentation matches the executable commands.

- [X] T103 [P] Harden the bootstrap checker in `scripts/check-bundle-size.mjs` and add `tests/unit/bundle-accounting.test.ts`: enumerate every emitted browser JavaScript asset including lazy chunks and service-worker JavaScript, exclude source maps, individually gzip at level9 and sum exact bytes; require strictly below150000 bytes (fail at or above150000, following constitution VII and quickstart), report per-file totals/runtime/options. Check exported asset inventory so chunk splitting, alternate extensions or precache layout cannot hide emitted JS; keep native/server bundles out of the browser inventory. (Depends on T102.)

- [X] T104 [P] Implement `scripts/benchmark.mjs`, `tests/fixtures/benchmark-data.ts`, and `docs/performance.md`: pinned Node/Linux4vCPU8GiB/localSSD profile, OS/SQLite versions, deterministic20projects/1000tasks/10000occurrences/50000audits plus diagnostic10000tasks/100000occurrences;100coldCLI subprocess calls,10warmup+500query samples including materialization,10builds, p50/p95/max and4writers/20readers stress. Separate <=5min command, record duration/exit/failures, call <100ms CLI/<15ms query/<5s build goals until calibrated, never fabricate a gate or pass. (Depends on T102.)

- [X] T105 [P] Write `README.md`, `docs/operations.md`, and `docs/compatibility.md` for clean install/run/dev, exact CLI/API examples, network-origin policy and current unauthenticated access, manual backup/restore/recovery copies and maintenance errors, Linux local-FS/flock requirements, cache limitations, settings/recurrence retirement and epoch reconciliation. Document schema v1 has no released predecessor, future populated migration fixtures/breaking-contract upgrade/rollback obligations, and NORMAL sync durability limits without promising zero data loss. (Depends on T102.)

- [X] T106 Complete `tests/acceptance-coverage.md`, `tests/mutation-coverage.md`, and `tests/fixtures/contract-matrix.ts`: map every FR-001–FR-026, VT-01–VT-11, SC-001–SC-013 and constitution principle to concrete implementation/tests; require every CLI command/HTTP route/UI family present with no silently skipped pending rows, query-purity and operational N/A rationale, real race/recovery evidence, and no new authentication, Telegram, LLM, hard delete or task move surface. (Depends on T103, T104, T105.)

- [X] T107 Run locked clean install, production migration/native smoke, strict typecheck/lint/format check, build, functional/compiled CLI/Fastify contracts, independent-process contention, Chromium/WebKit production mobile/offline/recovery suites and exact bundle check using `package.json`; run separately budgeted benchmarks and executable `specs/001-ai-task-manager/quickstart.md` scenarios. Record commands, environment, exit codes, durations, artifact paths and honest pending/failing checks in `docs/validation.md`; fix failures and rerun relevant checks without bypassing Git hooks. (Depends on T106.)

**Checkpoint**: The release checkpoint requires all stories and hard gates; benchmark goal misses are reported with evidence and do not silently become acceptance failures. No deployment or commit is implied by this backlog.

---

## Dependencies and execution order

All stories are P1; this is dependency order within one priority, not a reprioritization. The conservative execution lane is:

```mermaid
flowchart LR
  Setup --> Foundation --> US1 --> US2 --> US3 --> US5 --> US4 --> US6 --> Release
```

US1 supplies ordinary project/task state. US2 supplies configurable models/workflows and graph guards. US3 finishes the supervised transport and evidence matrix. US5 extends project/config lifecycle guards with real recurring state; US4 then queries those actual occurrences. US6 adds offline and full recovery on the already supervised, audited engine. Each checkpoint uses its own deterministic fixtures and tests; it does not need a human to run earlier UI journeys. Shared foundation and explicitly named predecessor capabilities remain prerequisites, so independence does not mean incompatible domain rules can be developed in isolation.

Every task line states its immediate prerequisites; dependencies are transitive. Parallel groups are waves with disjoint write paths and a common completed predecessor gate. Integration tasks serialize edits to shared entry points. Do not concurrently edit shared registrations, package manifests or schema exports across waves. Foundation covers every table because ownership, history, locks and later lifecycle invariants share the same initial schema; domain behavior stays in its owning story.

## Parallel examples per story

| Story | Example disjoint wave | Start condition |
|---|---|---|
| US1 | T022, T023, T024 | Complete T021 and the story entry gate first. |
| US2 | T039, T040, T041 | Complete T036, T037, T038 and the story entry gate first. |
| US3 | T054, T055, T056 | Complete T053 and the story entry gate first. |
| US4 | T085, T086 | Complete T083, T084 and the story entry gate first. |
| US5 | T075, T076 | Complete T073, T074 and the story entry gate first. |
| US6 | T100, T101 | Complete T098, T099 and the story entry gate first. |

These are examples, not additional tasks. All other `[P]` waves follow the same rule; tests may be authored in parallel only in their separate files, then observed failing through the working harness before implementation.

## Requirement and verification traceability

The command-level mutation matrix at the top applies to every implementation row, even when a task description does not repeat it. The following map assigns each requirement to concrete backlog owners; final coverage adds executable case names.

| Requirement | Implementation owners | Verification owners |
|---|---|---|
| FR-001 | T002, T017, T019, T018 | T021, T106 |
| FR-002 | T028, T029, T068, T069 | T022, T060 |
| FR-003 | T017, T018, T019 | T007, T048 |
| FR-004 | T017, T011 | T007, T049 |
| FR-005 | T011, T051, T042, T095 | T050, T089 |
| FR-006 | T039, T040, T042 | T036, T078 |
| FR-007 | T080, T081 | T078, T079 |
| FR-008 | T027, T029 | T022, T024 |
| FR-009 | T040, T029, T067 | T036, T061 |
| FR-010 | T042, T069 | T036, T060 |
| FR-011 | T063, T064, T065, T066, T067 | T058, T059, T060 |
| FR-012 | T016, T063, T070, T033 | T022, T058, T078 |
| FR-013 | T026, T029, T064, T034 | T023, T024, T058 |
| FR-014 | T080, T081, T082, T085, T086 | T078, T079 |
| FR-015 | T018, T054, T072 | T048, T107 |
| FR-016 | T012, T015, T052, T017 | T048, T106 |
| FR-017 | T019, T053 | T021, T050 |
| FR-018 | T020, T033, T045, T075, T100 | T088, T106 |
| FR-019 | T092, T093, T101, T034 | T088 |
| FR-020 | T019, T020, T053 | T050, T106 |
| FR-021 | T017, T034, T052, T096 | T007, T022, T089 |
| FR-022 | T014, T095, T096, T105 | T006, T089, T090 |
| FR-023 | T041, T029, T042 | T037 |
| FR-024 | T025, T029, T068, T032 | T023, T049 |
| FR-025 | T025, T028, T009, T094, T095 | T023, T049, T089 |
| FR-026 | T094, T095, T096, T097, T100 | T089, T090, T091 |

| Verification / success criteria | Owning test and gate tasks |
|---|---|
| VT-01; SC-001, SC-002, SC-003, SC-009 | T022, T036, T058, T059, T060, T078 |
| VT-02; SC-004 | T007, T022, T036, T059, T089, T106 |
| VT-03 | T006, T089, T107 |
| VT-04 | T008, T037, T049, T060, T090, T107 |
| VT-05; SC-005 | T048, T057, T077, T087, T102, T106, T107 |
| VT-06; SC-006, SC-007, SC-010 | T050, T088, T091, T107 |
| VT-07 | T002, T006, T021, T106, T107 |
| VT-08 | T005, T078, T103, T104, T107 |
| VT-09; SC-011 | T037, T036, T060 |
| VT-10; SC-012 | T023, T024, T049 |
| VT-11; SC-008, SC-013 | T022, T024, T058, T088, T089, T090, T091 |

| Constitution obligation | Implementation / verification tasks |
|---|---|
| I — standalone SQLite core, thin adapters, no embedded AI/Telegram | T002, T017, T018, T019, T106 |
| II — explicit immutable project scope and atomic immutable audit | T009, T011, T017, T007, T095, T089 |
| III — compiled deterministic noninteractive CLI | T003, T018, T048, T106, T107 |
| IV — full430px mobile and offline reopening/read-only cache | T020, T092, T093, T088, T102 |
| V — functions/types/boundaries/complexity; pure queries and synchronous mutations | T002, T017, T052, T080, T021, T107 |
| VI — real SQLite, every-mutation coverage, separate-process contention and meaningful regression | T004, T006, T007, T008, T049, T060, T090, T106 |
| VII — bounded queries/index evidence, compiled native boundary, measured goals and exact JS gate | T003, T005, T078, T087, T103, T104, T107 |
| Stack, migration/compatibility, privacy, recovery and governance/no hook bypass | T001, T014, T019, T097, T105, T106, T107 |

## Implementation strategy

1. Complete Setup and Foundation; establish a functioning harness before accepting red feature tests.
2. Implement and validate US1 as the first demonstration: ordinary capture/edit/default workflow/confirmation/emoji/archive/conflicts through compiled CLI and mobile UI. This is the suggested MVP slice, not a scope reduction.
3. Add US2 customization/dependencies, then US3 transport/history guarantees. Keep prior checkpoints passing. Complete US5 recurrence/lifecycle/settings before US4 read views so projections are verified on real occurrence state.
4. Complete US6 offline and administrative recovery. Validate new epochs, retained proposals and every mobile operation under production assets.
5. Finish full traceability, hard release gates and independently reported performance measurements. Do not claim completion while contract rows, applicable mutation tests, browser operations or recovery failpoints remain pending. Record the first-schema upgrade N/A honestly.
6. Use the marked disjoint waves for parallel work after their gates. Serialize shared integration. Fix failures in scope and rerun relevant checks; never disable Git hooks. Commits, deployment and external publishing are separate actions, not implied tasks.

## Backlog summary

| Scope | Tasks |
|---|---:|
| Shared setup/foundation/release | 26 |
| US1 | 14 |
| US2 | 12 |
| US3 | 10 |
| US4 | 10 |
| US5 | 20 |
| US6 | 15 |
| **Total** | **107** |

There are 77 `[P]` tasks in 29 disjoint waves grouped by common prerequisites. T071 must finish before T072 starts; due-work discovery cannot be implemented concurrently with its worker caller. All 107 tasks are initially unchecked. Each has a unique sequential ID, a concrete repository-relative path, and explicit prerequisites; story phases carry their original US label. No product clarification markers or template placeholders remain.

Artifact validation at generation time covers checklist structure, unique/sequential IDs, labels, path presence, dependency references/order, disjoint parallel paths, all six story phases, and FR/VT/SC traceability. It does not claim that application tests, native builds or benchmarks have run.
