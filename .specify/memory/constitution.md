# AI Tasks Constitution

## Core Principles

### I. Code Quality

Every change MUST use clear names, explicit contracts, and cohesive functions and modules.
Contributors MUST follow established repository conventions and validate external inputs at
system boundaries. Errors MUST carry actionable context without exposing secrets or sensitive
data. Configured formatting, linting, type checks, and build checks MUST pass before merge.
Review MUST address correctness, security, and failure handling, including for generated code.
Consistent, explicit code makes defects easier to detect and changes easier to review.

### II. Speed Through Small Changes and Measurement

Work MUST be delivered in the smallest independently verifiable increments that satisfy the
accepted requirements. Contributors MUST reuse suitable existing capabilities and avoid
speculative abstractions, unrelated refactors, and dependencies without a concrete need.
Performance-sensitive work MUST define a measurable budget, representative workload, and
measurement method before implementation; changes MUST report results against that budget.
Optimization MUST be supported by profiling or benchmark evidence. Delivery speed MUST come
from reducing scope, automating repeated work, and shortening feedback loops while preserving
required quality gates.

### III. Testing That Proves Behavior

New or changed executable behavior MUST have automated tests proportional to its risk. Tests
MUST assert observable outcomes and relevant failure cases rather than mirror implementation.
Bug fixes MUST include a regression test demonstrated to fail before the fix when reproducible;
any inability to reproduce MUST be documented with an alternative verification method.
Unit tests MUST cover isolated logic, integration or contract tests MUST cover changed system
boundaries, and end-to-end tests MUST cover affected critical user journeys where lower-level
tests cannot prove the outcome. Tests MUST be deterministic and isolate external dependencies
unless explicitly designated as integration tests. Documentation-only or mechanical changes
MAY use focused validation instead of new tests, with the reason recorded in the review.

### IV. Maintainability and Simplicity

Modules MUST have explicit responsibilities and dependencies. Contributors MUST choose the
simplest design that meets current requirements and document significant architectural choices
and their tradeoffs. Changes to public interfaces, configuration, or operational behavior MUST
update the relevant documentation in the same change. Breaking changes MUST include migration
instructions and a recovery strategy. New dependencies MUST have a documented purpose and an
assessment of maintenance, security, and operational cost. Temporary workarounds MUST reference
tracked follow-up work with an owner and a removal condition, so debt remains actionable.

### V. AI-Driven Development with Accountability

Contributors MUST use AI assistance where it reduces implementation, investigation, testing, or
review effort, and MAY omit it when privacy, access, or task suitability makes it inappropriate.
Before editing, AI agents MUST inspect applicable instructions, relevant code, and acceptance
criteria. Generated changes MUST meet the same quality gates as human-written changes; a human
maintainer remains accountable for acceptance and merge. Contributors MUST verify generated
API usage, dependencies, and claims against repository evidence or authoritative documentation.
Agents MUST keep changes within authorized scope, protect credentials and private data, and
report actual checks run, results, assumptions, and unresolved limitations. AI output or an AI
review alone MUST NOT be treated as proof of correctness or as human approval.

## Engineering Constraints

- Specifications MUST state observable acceptance criteria, failure behavior, and relevant
  security, privacy, compatibility, and performance requirements.
- Secrets MUST remain outside source control. Logs, fixtures, and AI inputs MUST exclude
  credentials and private data unless their use is explicitly authorized for that destination.
- Dependencies and toolchains MUST be reproducible through the repository's versioning and
  lockfile mechanisms where supported. Changes MUST preserve a documented local check path.
- Runtime changes MUST provide enough diagnostics to identify failures; new operational
  dependencies MUST document configuration and recovery behavior.
- Git hooks MUST run normally. A failing hook MUST be fixed and rerun; bypassing a hook requires
  explicit user permission for that specific operation and a recorded explanation.

## Development Workflow and Quality Gates

1. Define scope and acceptance criteria; identify affected boundaries, risks, and verification
   methods. Resolve material ambiguity before dependent implementation begins.
2. Inspect existing code and instructions, then choose a minimal design. Record any significant
   tradeoff, performance budget, or requested constitutional exception in the plan.
3. Implement a focused change with appropriate tests and documentation. Keep independent work
   separate and avoid changes outside the agreed scope.
4. Run relevant automated tests and all configured required checks. Review the diff for
   correctness, security, maintainability, scope, and compliance with every core principle.
5. Before merge, provide a review summary describing behavior changes, verification commands
   and results, and remaining risks. Unavailable or failing required checks MUST be reported
   as incomplete; they MUST NOT be described as passing. A human maintainer MUST accept the
   change, and required checks MUST pass unless a permitted exception has been approved.

## Governance

This constitution governs project engineering decisions. Specifications, plans, tasks, and
reviews MUST be checked against it; conflicting project guidance MUST be reconciled before
implementation proceeds. Platform requirements and explicit authorization boundaries continue
to apply.

Amendments MUST describe the proposed change, its rationale, affected workflows, and any
migration required. A project maintainer MUST approve amendments before adoption. Each amendment
MUST update the version and last-amended date while preserving the original ratification date.
MAJOR versions represent incompatible removals or redefinitions of principles; MINOR versions
add principles or materially expand guidance; PATCH versions clarify wording without changing
obligations. Version 1.0.0 establishes the initial constitution.

Every implementation plan and change review MUST assess compliance. Exceptions MUST identify
the affected rule, justification, risks, compensating checks, owner, and expiry or removal
condition, and MUST receive explicit maintainer approval before merge. Exceptions MUST NOT
supersede platform restrictions or grant authority to bypass Git hooks without the specific
user permission required above. Recurring exceptions MUST trigger a review of the rule or the
underlying implementation.

**Version**: 1.0.0 | **Ratified**: 2026-10-20 | **Last Amended**: 2026-10-20
