# AI Tasks Constitution

## Core Principles

### I. Dual-Interface Thin-Adapter Architecture

The system is a standalone task and project state engine exposing a CLI for external AI
harnesses and a Web UI for the human user over one local database. Telegram bots, LLM
orchestration, and reverse-proxy routing are out of scope.

Domain logic and application database queries MUST reside in `src/core/`. CLI commands
(`src/cli/`) and HTTP routes (`src/api/`) MUST be thin adapters: validate inputs through Zod,
invoke core functions, and translate results or errors into transport responses. Business
rules MUST NOT be duplicated between interfaces. Schema definitions, migration tooling, and
test fixtures MAY access the database directly for their respective responsibilities.

### II. Project Isolation on Write, Global Visibility on Read

Projects MUST have unique slugs. Task listings, agendas, priorities, and workload statistics
MUST support single-project filtering and cross-project aggregation (`--all-projects` in CLI).
Mutations of project-owned data MUST require an explicit target `project_slug`. Operations
on existing tasks MUST reject a task belonging to another project with `PROJECT_MISMATCH`
before changing any data.

Every successful domain mutation MUST atomically append an audit record containing the actor
(`human-web` or `ai-cli:<project_slug>`), timestamp, affected entity, and changed fields in the
same SQLite transaction. Application operations MUST NOT modify or delete existing audit
records. Rejected or rolled-back mutations MUST leave neither partial state changes nor
success audit records. Project creation MUST identify the new slug; task-ownership checks
apply only to operations targeting existing project-owned entities.

### III. Deterministic, Agent-Friendly CLI Contract

The CLI MUST be non-interactive: no TTY prompts, spinners, or pagers. Every application command
MUST support `--json`, emitting machine-readable results on `stdout` without diagnostic noise.
Failures, including invalid command arguments, MUST emit structured JSON errors on `stderr`
and return non-zero exit codes. Stable error codes include `VALIDATION_ERROR`, `TASK_NOT_FOUND`,
`PROJECT_NOT_FOUND`, `PROJECT_MISMATCH`, and `DB_CONFLICT`.

Contracts MUST define result ordering, date/time representation, and error structure so the
same inputs, database state, and clock produce equivalent results. Changed CLI behavior MUST
have contract tests covering output streams, exit status, and applicable error cases.

### IV. Mobile-Only Vertical UI & Offline Read Resilience

The Web UI MUST use a single-column mobile layout with `width: 100%`, `max-width: 430px`,
and touch targets at least 44px. On larger displays the column MUST be centered; multi-column
desktop layouts are out of scope.

The Web UI MUST persist the latest successfully fetched task and priority data in browser
storage. After a successful online load, cached data MUST remain readable in an already-open
tab when connectivity is lost. The UI MUST indicate offline status and the last successful
refresh, disable mutations while offline, and explain when requested data is not cached.

The offline feature specification MUST explicitly state whether offline reload/reopening is
also supported and include acceptance scenarios for that decision, missing cache, stale data,
and disabled writes. If reload/reopening is supported, the plan MUST cover availability of
the application shell as well as cached data. Persistence technology belongs in the plan.

### V. Simple Functions, Type Safety & Module Boundaries

- **Functions over classes**: Domain logic MUST use plain exported functions with explicit
  dependencies and validated inputs. Service/repository classes, DI containers, and
  single-implementation interfaces are forbidden. Authored classes are permitted only for
  custom error types. Time-dependent logic MUST accept an explicit clock or `now` value.
- **Dependency direction**: Imports MUST follow `schema <- core <- cli/api`, without cycles.
  `src/schema/` MUST NOT depend on core or transport modules; imports within the schema layer
  are allowed. The Web UI MAY share browser-safe Zod schemas and types from `src/schema/`,
  but MUST NOT import core, server adapters, or database runtime code.
- **Command-query separation**: Query functions MUST be side-effect free. Domain mutation
  functions MUST commit state changes and audit insertions in one `db.transaction()`.
- **Single source of types**: Domain and DTO types MUST be inferred from Drizzle tables and
  Zod schemas rather than duplicated manually. TypeScript MUST enable `strict`,
  `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`. Explicit `any`, `@ts-ignore`,
  `@ts-expect-error`, and non-null assertions are forbidden in application source.
- **Cohesion and complexity**: Modules and functions MUST have explicit, focused
  responsibilities. Lint configuration MUST define size, complexity, nesting, and parameter
  policies with separate scopes for production code, React components, tests, and generated
  files. Numeric thresholds and their rationale belong in that configuration and its setup
  plan. Code MUST NOT be fragmented solely to satisfy a line count. Prefer guard clauses and
  named options over deep nesting and ambiguous boolean parameters. Changes to lint policies
  MUST explain the tradeoff; disabling checks to conceal a failure is forbidden.

### VI. Behavior-Focused Testing & Real Database Verification

- **Proportional coverage**: New or changed executable behavior MUST have automated tests
  proportional to risk, including affected reads, CLI/API contracts, and UI behavior. Tests
  MUST assert observable outcomes. Documentation-only and mechanical changes MAY use focused
  validation with a recorded reason.
- **Real persistence tests**: Database integration tests MUST use isolated SQLite databases
  with the production migration path applied. Pure logic tests do not require a database.
  Mocking database connections or internal core functions to substitute for actual behavior
  is forbidden. In-memory databases MAY be used where file locking and WAL are irrelevant.
- **Mutation coverage**: Tests MUST cover successful state and audit changes, applicable input
  validation failures, ownership rejection for existing project-owned entities, and rollback
  without partial state or success audit records. Non-applicable cases MUST be justified in
  the plan's verification matrix; they MUST NOT be replaced with artificial scenarios.
- **Actual contention**: The database integration suite MUST exercise overlapping writes from
  independent workers or processes, each with its own connection to the same temporary file.
  A start barrier or equivalent coordination MUST establish contention; `Promise.all` around
  synchronous calls in one thread is insufficient. Tests MUST verify successful completion
  after a transient lock, controlled `DB_CONFLICT` after the configured wait is exhausted,
  and correct state/audit outcomes without lost or duplicated successful writes.
- **Separate execution budgets**: Functional tests, contention tests, and benchmarks MUST have
  separately documented commands and timeout settings. Contention timeouts MUST accommodate
  the configured database wait and worker startup. Use injected time or fake timers for
  domain-time behavior; real lock tests MUST use synchronization and bounded deadlines
  instead of arbitrary sleeps. Suite duration MUST be reported without a universal 3-second
  gate.
- **Regression first**: Bug fixes MUST begin with a failing regression test when reproducible.
  If reproduction is unavailable, record the limitation and an alternative verification
  method before applying the fix.

### VII. Measured Query, Runtime & Build Performance

- **Bounded query work**: Avoid N+1 access by using joins, aggregation, and batch operations.
  Per-record queries MUST have a documented need and bounded workload. Chunked operations
  MAY be used for parameter or memory limits; they MUST preserve required transaction
  atomicity. Query counts and representative workloads MUST support performance claims.
- **Workload-driven indexes**: Indexes MUST be defined alongside the schema and justified by
  access patterns, including project filters, joins, and ordering. Critical query paths MUST
  be reviewed using `EXPLAIN QUERY PLAN` and representative benchmarks. Composite indexes and
  existing primary/unique indexes MUST be considered before adding redundant indexes.
- **Reproducible measurements**: Every enforced timing budget MUST specify the measurement
  command, runtime and machine/CI profile, dataset and distribution, concurrency, cold/warm
  conditions, repetitions, statistic, and tolerance. Plans MUST distinguish goals from
  enforced gates; absent an agreed method, timing targets MUST NOT block correctness work.
- **Initial timing goals**: Target p95 below 100ms for standard CLI invocations without lock
  contention, p95 below 15ms for agenda/list queries over a representative 1,000-task fixture,
  and a production UI build below 5 seconds on the documented reference environment. CLI
  measurements MUST include process startup and completion; query measurements MUST state
  whether preparation and result materialization are included. Lock-wait behavior is measured
  separately. These goals become gates only when a plan defines and validates their method.
- **Build artifacts**: Production CLI execution MUST use a precompiled `dist/cli.js` entry
  built with `tsup`/`esbuild`, without runtime TypeScript transpilation. Required native
  dependencies MAY remain external. The UI production build MUST stay below 150 KB
  (150,000 bytes), measured as the sum of individually gzipped emitted JavaScript assets,
  including lazy-loaded chunks and excluding source maps. The measurement command and
  compression settings MUST be versioned. Heavy utility libraries such as `moment` and
  `lodash` are forbidden; prefer native `Intl` and standard APIs.

## Technical Stack & Operational Constraints

- **Runtime and tooling**: Node.js (v22+) or Bun with TypeScript, Vitest, ESLint, and Prettier
  (or Biome for formatting); `tsup` for CLI builds. The setup plan MUST select and pin the
  runtime/toolchain and verify compatibility with native dependencies. Commit the package
  manager lockfile and document reproducible installation and check commands.
- **Database**: Local SQLite via `better-sqlite3` and Drizzle ORM. File-backed databases MUST
  use WAL; connections MUST enable foreign keys, `synchronous = NORMAL`, and a default
  `busy_timeout = 5000`. Isolated contention tests MAY use a documented shorter wait to
  exercise timeout handling. In-memory tests are exempt from WAL. Connection setup MUST
  verify effective settings.
- **Backend and CLI**: Fastify bound to `127.0.0.1`, tested with `fastify.inject()`;
  `commander` for CLI parsing.
- **Frontend**: React, Vite, Tailwind CSS, and TanStack Query with offline persistence.
- **Dependencies**: Every new dependency MUST be justified in the implementation plan with
  its purpose and maintenance, security, and operational costs. Prefer standard APIs for
  small utilities; avoid custom reimplementations of complex functionality solely to reduce
  dependency count.
- **Compatibility and recovery**: Public contract changes MUST update documentation in the
  same change. Breaking changes MUST document migration and recovery steps. Database schema
  changes MUST include versioned migrations and tests upgrading populated prior schemas
  while preserving data and audit history. Fresh-schema tests alone are insufficient.
- **Privacy and diagnostics**: Secrets MUST stay outside source control. Errors, logs,
  fixtures, and AI inputs MUST NOT disclose credentials or private data to unauthorized
  destinations. Relevant security/privacy risks and operational recovery behavior MUST be
  addressed in the feature plan.

## Development Workflow and Quality Gates

1. **Specification (`/speckit.specify`)**: Specifications MUST define user needs, scope,
   observable behavior, technology-independent success criteria, and testable acceptance
   scenarios in language understandable to nontechnical stakeholders. Describe affected
   human and assistant interactions by their outcomes. Specifications MUST NOT prescribe
   languages, frameworks, database engines, API schemas, CLI signatures, source layout,
   test tools, or other implementation mechanisms. Technical requirements from the user
   or this constitution MUST be retained in the plan and contracts rather than copied into
   the specification. Acceptance scenarios MUST state expected successes, failures and
   relevant boundaries without selecting the test harness or implementation.
2. **Planning (`/speckit.plan`)**: The `Constitution Check` MUST cover every applicable
   principle before research and again after design. Record each obligation, its planned
   implementation, verification method, and any justified N/A or approved exception.
   The plan and contracts MUST define affected CLI signatures, JSON/API schemas, technical
   constraints, migration/recovery needs, and performance measurement methods. The plan
   MUST explicitly require every applicable Principle VI test, define its mechanism and
   execution budget, and map it to the specification's observable acceptance outcomes.
   Its verification matrix MUST state which mutation coverage cases apply and justify
   every N/A. Technical checks without a direct user-facing acceptance scenario MUST trace
   to the governing constitutional obligation. Planning checks assess design compliance;
   they MUST NOT claim runtime or lint verification that has not occurred.
3. **Task generation and analysis (`/speckit.tasks`, `/speckit.analyze`)**: Every applicable
   constitutional obligation MUST map to implementation or verification tasks, or reference
   an existing check that already covers it. Test work MUST be derived from acceptance
   scenarios, the plan's verification matrix, and Principle VI. Neither absence of technical
   test instructions in a specification nor generic template wording that tests are optional
   waives these obligations. Before implementation, verify traceability from acceptance
   criteria, planned verification and constitutional obligations to tasks. Resolve missing
   coverage and conflicting requirements before dependent work starts.
4. **Implementation (`/speckit.implement`)**: Run relevant checks after each coherent change.
   Run the complete configured required set, including typecheck, lint, build, and applicable
   test suites, at feature acceptance and before merge. Documentation-only changes MAY use
   focused validation. During bootstrap, track unavailable commands as pending setup tasks;
   required checks MUST be operational and pass before accepting executable functionality.
5. **Acceptance and honest reporting**: Compare the implementation against the specification,
   plan, and constitution, using `/speckit.converge` when applicable. Report commands, results,
   exit codes, durations, and unresolved limitations; include detailed output for failures
   or link saved logs. Skipped, unavailable, failed, or timed-out checks MUST NOT be described
   as passing. AI review alone is not proof of correctness or human approval.
6. **Git hooks**: Hooks MUST run normally. Fix a failing hook and rerun the check or operation.
   Bypassing a hook requires explicit user permission for that specific operation; a general
   constitutional exception does not grant it.

## Governance

This constitution governs repository engineering decisions and all Spec Kit artifacts,
including specifications, plans, tasks, implementation, and acceptance reviews. Conflicting
project guidance MUST be reconciled before dependent implementation. Platform restrictions
and explicit user authorization boundaries continue to apply.

Amendments require explicit user approval, a documented rationale, affected workflow and
migration notes, and a version/date update. MAJOR denotes incompatible removals or
redefinitions of principles or governance; MINOR adds principles or materially expands
guidance; PATCH clarifies wording without changing obligations. Preserve the ratification
date. Amendment rationale MAY be recorded in the commit or review.

Exceptions MUST be approved by the user and recorded in the plan's complexity tracking table,
including the affected rule, reason, risks, compensating checks, owner, and expiry or removal
condition. Reviewers MUST distinguish approved exceptions from unresolved violations.
Repeated exceptions MUST trigger reconsideration of the rule. A human maintainer MUST accept
the change before merge; agents MUST NOT infer acceptance from their own review.

Version 3.0.0, explicitly authorized by the user on 2026-10-21, corrects the 2.0.0 workflow
requirement that specifications contain CLI signatures and technical testing instructions.
That requirement conflicted with Spec Kit's original implementation-free, stakeholder-facing
specification criteria. This is a MAJOR change to artifact responsibilities; engineering,
coverage, execution and acceptance obligations remain mandatory.

Existing features MUST move technical specification content into their plan and contracts,
retain requirement identifiers and observable acceptance outcomes, recheck constitutional
traceability, and re-review checklist criteria without changing those criteria. Update active
version references and readiness assessments before dependent implementation. Historical
records MAY retain their original version when clearly identified as historical. No runtime
or database migration is needed for this documentation amendment. Project templates and
Spec Kit command rules remain unchanged.

**Version**: 3.0.0 | **Ratified**: 2026-10-20 | **Last Amended**: 2026-10-21
