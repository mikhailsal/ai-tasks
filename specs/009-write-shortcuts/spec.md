# Feature Specification: Shortcuts for the most frequent writes

**Feature**: `009-write-shortcuts`
**Created**: 2026-11-09
**Status**: Draft

**Input**: User description: "Recording one 'done' on a recurring task costs an AI agent five calls: list occurrences, find the right one, read the parent revision, write a request file, complete. One agent reported about 25 completions in a single week, all through a private wrapper, and expects every agent to write the same wrapper. Moving a task to another status needs the revision values and a fresh operation identifier in a file as well (feedback 28.10/3, 28.10/12(d), 9.11 summary). Give agents one-step forms for these two frequent writes and keep the strict form for scripts."

## User Scenarios & Testing

### User Story 1 - Mark an occurrence done by naming the task and the day (Priority: P1)

An agent says which recurring task, which day, and optionally when it was actually done and a note. The application finds the occurrence, uses the current revision values and records the completion.

**Why this priority**: This is the single most frequent write and the most expensive one today.

**Independent Test**: With a recurring task that has several occurrences, complete one by naming only the task and the day, and count the commands.

**Acceptance Scenarios**:

1. **Given** a recurring task with an occurrence on a given day, **When** an agent completes it by naming the task and the day, **Then** the completion is recorded in one command with no prior read.
2. **Given** an optional actual completion time and an optional note, **When** they are supplied, **Then** they are recorded exactly as in the strict form.
3. **Given** no occurrence on that day, **When** the shortcut is used, **Then** it is rejected and the response lists the nearest days that have occurrences.
4. **Given** several occurrences on that day, **When** the shortcut is used, **Then** it is rejected and the response lists the candidates with their identifiers and states, so that the next attempt can name one of them.
5. **Given** a task named by its identifier or, within a project, by its unique icon, **When** the shortcut is used, **Then** both ways of naming work.
6. **Given** an occurrence that is missed or owed, **When** the shortcut is used, **Then** it completes it, as the strict form does today.

---

### User Story 2 - Move a task to another status in one step (Priority: P1)

An agent names a task and the status it wants. The application applies the transition with the current revision values.

**Why this priority**: Status moves are frequent for the task owner's workflow, and each one costs reads and a request file today.

**Independent Test**: Move an ordinary task through two allowed statuses with one command each.

**Acceptance Scenarios**:

1. **Given** an ordinary task and an allowed target status, **When** an agent moves it, **Then** the transition is applied in one command with no prior read.
2. **Given** a target status that is not allowed from the current status, **When** the move is attempted, **Then** it is rejected and the response lists the statuses that are allowed from the current one.
3. **Given** an agent that states the status it expects the task to be in, **When** the actual status differs, **Then** the move is rejected without change and the response names the actual status.
4. **Given** a transition that needs more than a target status, such as an approval, **When** the move is attempted without it, **Then** the response says what is missing, as the strict form does.

---

### User Story 3 - Shortcuts are as safe and as visible as the strict form (Priority: P1)

A shortcut never does more or less than the strict form it replaces, and repeating it is safe.

**Why this priority**: The strict form exists so that different actors cannot silently overwrite each other and retries cannot double-apply. A convenience must not weaken that.

**Independent Test**: Repeat a shortcut, change the data between two attempts, and compare the audit trail with the strict form.

**Acceptance Scenarios**:

1. **Given** a shortcut that succeeded, **When** the same shortcut is repeated, **Then** no second effect is recorded and the response says that the existing record was returned.
2. **Given** an occurrence already completed with different data, **When** a shortcut is sent, **Then** it is rejected, the existing record is shown and nothing changes.
3. **Given** a shortcut and the strict write that does the same thing, **When** the audit trails are compared, **Then** they record the same facts.
4. **Given** the strict form, **When** it is used after this feature ships, **Then** it behaves exactly as before.

### Edge Cases

- Naming a task by an icon that does not exist or is ambiguous in the project is rejected with the known icons or the candidates listed.
- The day follows the occurrence day of specification 008; until that ships, it is the local calendar day of the deadline.
- A shortcut used against a paused or archived task follows the same rules and the same refusals as the strict form.
- A shortcut sent for a task in another project than the one given is rejected like any other mismatch.
- The response of a shortcut includes the identifiers and revision values that a follow-up strict write would need.

## Requirements

### Functional Requirements

- **FR-001 - Complete by task and day**: The interface MUST let an agent complete an occurrence by naming the recurring task and the day, with an optional actual completion time and an optional note.
- **FR-002 - Move by target status**: The interface MUST let an agent move an ordinary task to a target status by naming the task and the status.
- **FR-003 - Naming a task**: A task MUST be nameable by its identifier or, within a project, by its unique icon.
- **FR-004 - No prior reads**: Neither shortcut MUST require the agent to read revision values or to provide an operation identifier.
- **FR-005 - Candidates on ambiguity**: When no occurrence or more than one occurrence matches, the rejection MUST list the nearest days or the candidates with identifiers and states.
- **FR-006 - Allowed statuses**: A refused move MUST list the statuses allowed from the current status.
- **FR-007 - Optional precondition**: A move MUST accept an optional expected current status and MUST be rejected without change when the actual status differs.
- **FR-008 - Repeat safety**: Repeating a shortcut MUST NOT apply its effect twice, and MUST say that the existing record was returned.
- **FR-009 - Same rules and audit**: A shortcut MUST apply the same validation, the same refusals and the same audit trail as the strict write it stands for.
- **FR-010 - Strict form kept**: The strict form MUST remain unchanged and available.
- **FR-011 - Follow-up data**: A shortcut's response MUST include the identifiers and revision values that a follow-up strict write would need.
- **FR-012 - Compatibility**: Existing responses and exit statuses MUST stay as they are, and no input becomes newly required.

### Key Entities

- **Shortcut**: A one-step write that names its target by task and day or by task and status, and lets the application fill in the revision values and the operation identifier.
- **Task name**: A task's identifier, or its icon within one project.
- **Candidate**: An occurrence that matches the named task and day, with identifier and state.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A completion of a recurring occurrence takes 1 command instead of 5, and a status move takes 1 command instead of 3 or more.
- **SC-002**: 100% of prepared ambiguity cases (no match, several matches, unknown icon) are rejected with a list that lets the next attempt succeed.
- **SC-003**: For every shortcut the audit trail equals that of the equivalent strict write in 100% of prepared cases.
- **SC-004**: 0 duplicate effects when a shortcut is repeated, in 100% of prepared cases.
- **SC-005**: 0 changes to the strict form's behavior; existing contract checks stay green.

## Assumptions

- Primary users are AI agents. The web interface is unaffected.
- Only the two shortcuts named in the feedback are in scope: completion by task and day, and a move by target status. Other writes keep the strict form; the same naming by task and day applies to the miss action of specification 007 once it exists.
- The optional expected status is the only concurrency protection offered by the move shortcut, because the agent states its own expectation explicitly.
- Source feedback items: 28.10/3, 28.10/12(d), and the 9 November summary of 25 completions in one week.
