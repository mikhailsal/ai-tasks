# Feature Specification: Agent-ready diagnostics and onboarding

**Feature**: `004-agent-diagnostics-onboarding`
**Created**: 2026-11-09
**Status**: Draft

**Input**: User description: "AI agents are the primary users of the command interface; the human mostly reads in the web interface. Beta feedback from an AI agent (27 items, 2026-10-28 to 2026-11-09) and a developer-experience review (2026-11-09) show that a cold agent learns the interface by failing: rejected requests say what is wrong but rarely what to fix, missing values are reported one at a time, some refusals name the wrong remedy, and the documentation sends the agent to placeholder examples. Make the interface self-explaining so that a cold agent reaches its first task quickly and recovers from any rejection on the next attempt, without adding new commands, fields or states."

## Clarifications

### Session 2026-11-09

- Q: When a request contains field, option or command names the system does not recognize, should the rejection repeat those names? → A: Yes, names only and never values, in a bounded safe form: letters a-z, digits and underscore, plus hyphen for command and option names (the hyphen is a refinement because option names contain it), at most 64 characters per name and at most 10 names. (FR-008)
- Q: Should each corrective hint exist only as text for people, or also as separate machine-readable data for programs? → A: Both. The machine-readable data is an addition that programs knowing only today's fields tolerate. (FR-009)
- Q: How should the first-task outcome (SC-001) be verified at acceptance? → A: One recorded manual walkthrough by a cold agent; no automated recurring measurement. (FR-022)

### Session 2026-11-16

- Q: When archiving a recurring task or cancelling its occurrences is refused for several reasons at once, should the refusal name only the first reason or all of them? → A: All of them in one refusal, each with its next step, within the bounds of FR-021. The owner chose to add this to this specification rather than open a new one (feedback 11.11/2). (FR-023)

## User Scenarios & Testing

### User Story 1 - A cold agent creates its first task from the README alone (Priority: P1)

An AI agent that has never used the application, and has only the README and a shell, follows one documented path: prepare its environment, read the information it needs to prepare a change, create a task, and list tasks to confirm. Every step is a copy-paste example that works as written.

**Why this priority**: This is the entry gate. Today agents learn by failing (about eight attempts by trial, four on the ideal path) and then write private wrapper scripts.

**Independent Test**: On an empty scratch database with one existing project, a reader with no prior knowledge follows only the README path and counts commands and rejected requests.

**Acceptance Scenarios**:

1. **Given** a scratch database with an existing project, **When** a cold agent follows only the documented first-task path, **Then** the new task is visible in the task list after at most 5 commands and 0 rejected requests.
2. **Given** the README, **When** a cold agent prepares its environment, **Then** one copy-paste block covers the runtime, the database location and the working directory, and states what happens when the database location is not set.
3. **Given** any documented example, **When** it is run as written on a scratch database, **Then** it succeeds and prints machine-readable output.
4. **Given** the documentation, **When** an agent reads about output modes, **Then** it learns that the human-readable mode omits identifiers and revision values that follow-up changes need.

---

### User Story 2 - A rejected request says exactly what to fix (Priority: P1)

When the application rejects a request, the response tells the agent what was wrong, how to correct it, and where to obtain any missing value, so that the next attempt succeeds.

**Why this priority**: Each avoidable rejection costs the agent a call and sometimes a whole working session. Today a rejection often carries only a code and a position.

**Independent Test**: Take a fixed list of representative rejected requests. For each, a reader who sees only the response builds a corrected request without opening any documentation.

**Acceptance Scenarios**:

1. **Given** a read request without a project or all-projects choice, **When** it is rejected, **Then** the response names both accepted choices.
2. **Given** a value outside a fixed set of allowed values (for example a priority level name outside the built-in four-level scale), **When** it is rejected, **Then** the response lists the allowed values.
3. **Given** a value whose allowed set depends on the project's configuration (for example a status), **When** it is rejected, **Then** the response says where the allowed values can be read.
4. **Given** a request of the wrong shape or type, **When** it is rejected, **Then** the response states what was expected at that place; where several alternatives are accepted, it states what each alternative expects.
5. **Given** a change request that lacks several required revision values, **When** it is rejected, **Then** one response lists every missing value and, for each, the command or place that supplies it.
6. **Given** a request that contains names the system does not recognize, **When** it is rejected, **Then** the response repeats those names in the bounded safe form of FR-008 and lists the accepted names.
7. **Given** a command used with an option it does not support, **When** it is rejected, **Then** the response names that option. **Given** a mistyped command or option, **Then** the response offers the nearest valid names.
8. **Given** any rejected request, **When** the response is read by a program that knows only today's response fields, **Then** that program keeps working: codes, exit status and existing fields are unchanged.
9. **Given** a request with more problems than a response can usefully list, **When** it is rejected, **Then** the response lists the first problems up to a fixed bound and says that more exist.
10. **Given** any rejected request, **When** the response is inspected, **Then** it contains no raw storage errors, stack traces, filesystem secrets or values the agent sent (the treatment of unrecognized names is covered by FR-008).
11. **Given** a rejected request whose response carries a corrective hint, **When** a program reads the response, **Then** the same hint is available to it as separate machine-readable data in addition to the text for people.

---

### User Story 3 - Misleading refusals name the real rule (Priority: P2)

Some refusals today point the agent at the wrong remedy or hide which input they refer to.

**Why this priority**: A wrong remedy is worse than none: the agent follows it, fails again, and may change state needlessly (for example pausing a daily habit).

**Independent Test**: For each refusal below, a reader who sees only the response knows the true rule and the correct next step.

**Acceptance Scenarios**:

1. **Given** a recurring occurrence that is owed (a debt), **When** an agent tries to cancel it, **Then** the response says that owed work cannot be cancelled and what can be done instead, and does not advise pausing the recurring parent as the remedy.
2. **Given** a configuration change preview that includes mappings for statuses or priorities that no task uses, **When** the preview reports issues, **Then** each issue names the mapping it refers to, identical issues are reported once, and the preview points to the list of mappings that are actually required.
3. **Given** the database cannot be found, **When** any command runs, **Then** the response says how the database location is chosen, what the default is, and what to do next.
4. **Given** a recurrence timing-mode change is refused because pending or owed occurrences exist, **When** the response is read, **Then** it states which kind of occurrence blocks the change and the next step.
5. **Given** a recurring task that is not paused and has both a future pending occurrence and an owed occurrence, **When** an agent tries to archive it, **Then** one refusal names every blocker with its next step, in the order the steps must be taken, so the agent does not learn them one request at a time.
6. **Given** a request to cancel several occurrences, some of which cannot be cancelled, **When** it is refused, **Then** the refusal names every occurrence that cannot be cancelled with the reason and the next step for each.

---

### User Story 4 - Recipes for the jobs agents actually do (Priority: P2)

An agent guide gathers, in one place, the information agents currently piece together from failures and from several documents.

**Why this priority**: One agent reported about 25 completions in a single week, all through a private wrapper around the same five-step routine, and expects every agent to write the same wrapper. A tested recipe removes that rediscovery without any new capability.

**Independent Test**: Follow each recipe on a scratch database; every step succeeds as written.

**Acceptance Scenarios**:

1. **Given** the guide, **When** an agent needs to change something, **Then** one table states, for each kind of change, which revision values are required and which command returns each.
2. **Given** the guide, **When** an agent needs a common job, **Then** a tested recipe exists for: recording something that already happened (including a first deadline in the past and completing missed work after the fact); marking a recurring item done with the fewest commands; making an every-N-days cycle follow the real completion date; what "completed late" means (the report came after the window; both times are kept); skipping one future occurrence; and starting the service automatically after a reboot as an optional example.
3. **Given** the guide, **When** an agent meets a common rejection, **Then** a table maps it to the action to take.
4. **Given** the existing documents, **When** they are compared with the contract, **Then** none contradicts it: the quickstart no longer implies that a past first deadline is rejected, and both the double use of the configuration revision on migration and the rejection of mappings for statuses that no task uses are stated where agents look.

---

### User Story 5 - Agents can see what changed (Priority: P3)

A change log lists the agent-visible changes of this feature.

**Why this priority**: Agents that wrap the interface need to learn that responses became richer without reading source history.

**Independent Test**: Read the change log after the feature is accepted and match each entry to an observable behavior.

**Acceptance Scenarios**:

1. **Given** the accepted feature, **When** an agent reads the change log, **Then** each behavior change from this feature appears with a one-line statement of what an agent will notice.

### Edge Cases

- A rejection with many problems lists the first problems up to a fixed bound and says that more exist.
- Hints for configuration-dependent values cannot list the values generically; they point to where to read them (User Story 2, scenario 3).
- In the human-readable output mode, rejections still say what to fix.
- Responses never include raw storage errors, stack traces, filesystem secrets or values the agent sent. Unrecognized names are repeated only in the bounded safe form of FR-008; a name outside that form is counted but not repeated.
- The web interface shows the same rejections to the human and must keep working: it is one of the programs covered by FR-019.
- Retrying after an uncertain outcome is unchanged: the same request is recognized as the same, and existing retry rules are untouched.

## Requirements

### Functional Requirements

- **FR-001 - First-task path**: The README MUST give one documented path from a fresh environment to a created and listed task using at most 5 commands, with every example runnable as written.
- **FR-002 - Environment block**: The documentation MUST give one copy-paste environment preparation block and MUST state the behavior when the database location is not set.
- **FR-003 - Machine-readable examples**: Every documented example MUST use the machine-readable output mode, and the documentation MUST state what the human-readable mode omits.
- **FR-004 - Scope rejection**: A read rejected for lacking a project or all-projects choice MUST name both accepted choices.
- **FR-005 - Value hints**: A rejection for a value outside a fixed set MUST list the allowed values; for a configuration-dependent set it MUST say where to read them.
- **FR-006 - Shape hints**: A rejection for the wrong shape or type MUST state the expectation at that place and, for alternatives, the expectation of each.
- **FR-007 - All missing values at once**: A change request lacking required revision values MUST be rejected with every missing value listed once, each with its source.
- **FR-008 - Unrecognized names**: When a request contains field, option or command names the system does not recognize, the rejection MUST repeat those names together with the accepted names. Only names are repeated, never values. A repeated name MUST be limited to letters a-z, digits and underscore (plus hyphen for command and option names) and to 64 characters. At most 10 names are repeated, and the response MUST say when more were received. A name outside the safe form is not repeated but is counted.
- **FR-009 - Machine-readable hint**: Each corrective hint MUST be available both as text for people and as separate machine-readable data that a program can act on. The machine-readable data MUST be an addition that programs knowing only today's fields tolerate (FR-019).
- **FR-010 - Unsupported option**: A command used with an option it does not support MUST be rejected with the option named.
- **FR-011 - Nearest valid names**: A mistyped command or option MUST be rejected with the nearest valid names offered, drawn only from known names.
- **FR-012 - Debt cancellation**: Cancelling an owed occurrence MUST be refused with a statement that owed work cannot be cancelled and what is possible instead; the refusal MUST NOT present pausing the parent as the remedy for it.
- **FR-013 - Preview issues**: Configuration preview issues MUST name the mapping they refer to, MUST NOT repeat identical issues, and MUST point to the required mappings.
- **FR-014 - Missing database**: A missing database MUST be reported with how the location is chosen, the default, and the next step.
- **FR-015 - Timing-mode refusal**: A refused timing-mode change MUST state which kind of occurrence blocks it and the next step.
- **FR-016 - Agent guide**: The documentation MUST include a table of required revision values and their sources per kind of change, tested recipes for the jobs listed in User Story 4, and a table from common rejections to actions.
- **FR-017 - Documentation consistency**: No document may contradict the contract on past first deadlines, the double use of the configuration revision on migration, or the rejection of mappings for statuses that no task uses.
- **FR-018 - Change log**: A change log MUST list each agent-visible behavior change of this feature.
- **FR-019 - Compatibility**: Existing error codes, exit statuses, response fields and meanings, and all success responses MUST stay unchanged. Any addition MUST be tolerated by a program that knows only today's fields. No input becomes newly required.
- **FR-020 - Safety**: Responses MUST NOT contain raw storage errors, stack traces, filesystem secrets or values taken from the request.
- **FR-021 - Bounded responses**: Lists of problems or hints MUST be bounded and MUST indicate when they are cut.
- **FR-022 - Acceptance walkthrough**: Acceptance MUST include one recorded walkthrough in which a cold agent follows only the README on an empty scratch database. The acceptance report MUST record the command count, the number of rejected requests and the elapsed time. No automated recurring measurement is required.
- **FR-023 - Every blocker at once**: A refusal to archive a recurring task or to cancel its occurrences MUST name every cause in one response, each with its next step and in the order the steps must be taken, within the bounds of FR-021. For an owed occurrence the next step named MUST be one that exists: completion and, once specification 007 is available, closing it as missed with a reason.

### Key Entities

- **Rejection response**: What the application returns when it refuses a request: a stable code, a message for people, and supporting information for programs. This feature enriches the content, not the identity, of these parts.
- **Revision value**: A value an agent must send to prove it saw the current state (a task revision, a project configuration revision, a settings revision, an occurrence revision, the database epoch). Each has a known source command.
- **Agent guide**: The documentation set that maps jobs, revision values and rejections to actions.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A cold agent following only the README creates a task and sees it in the task list in at most 5 commands, with 0 rejected requests, in 2 to 5 minutes.
- **SC-002**: For a fixed list of at least 12 representative rejected requests covering FR-004 to FR-015, a reader who sees only the response builds a corrected request that succeeds on the next attempt in 100% of cases.
- **SC-003**: A change request missing two or more required revision values is corrected in one follow-up request, not one per value.
- **SC-004**: 0 changes to existing codes, exit statuses, response fields and success responses; existing contract checks stay green.
- **SC-005**: 100% of documented examples run as written on a scratch database.
- **SC-006**: An agent archiving a recurring task blocked for several reasons receives all of them in the first refusal: 1 refused request before it knows the full list, not one per blocker.

## Assumptions

- Primary users are AI agents using the command interface. The human mostly reads in the web interface and must see everything agents see. This feature changes diagnostics and documentation only; stored data and what the web interface shows are unchanged.
- Scope is deliberately limited to existing capabilities: no new commands, fields, states or recurrence outcomes. Self-describing per-command help is a separate feature, chosen by the owner as the main onboarding aid and specified on its own. Convenience commands, skip or miss outcomes with reasons, goal counters and worker liveness are separate specifications (009, 007, 008, 011); new task fields remain a candidate.
- SC-001 counts a cold agent with an existing project, from the README to a task visible in the task list. Today's estimates are about 8 commands by trial and 4 on the ideal path; both are unmeasured.
- Rejection codes stay as they are; a user-fixable condition reported today under an internal-error code keeps that code, because changing it is a contract change outside this feature.
- Messages stay in English, as today.
- The limits for repeated unrecognized names (10 names, 64 characters each) are fixed by the clarification above. The bounds for lists of problems and hints are chosen in the plan.
- Running as an always-on service stays out of scope for the application (specification 003); only an optional documentation example is added.
- Source feedback items: 28.10/0a, 0b, 0c, 1, 2, 8a, 8c, 12a, 12b, 13, 16; 3.11/8; 8.11/9a; 9.11/14; 11.11/2. The developer-experience review of 2026-11-09 is kept by the owner outside the repository.
- Changed command-line behavior needs contract checks for streams, exit status and applicable error cases (Constitution III), and documentation changes ship in the same change as the behavior they describe.
