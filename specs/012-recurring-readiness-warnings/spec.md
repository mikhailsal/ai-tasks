# Feature Specification: Recurring task readiness warnings and single time entry

**Feature**: `012-recurring-readiness-warnings`
**Created**: 2026-11-09
**Status**: Draft

**Input**: User description: "A recurring task created as a draft silently generates no occurrences, and neither the create result nor later reads say so; the AI agent noticed a day later (feedback 3.11/8). Creating a recurring task also asks for its time twice, once in the first deadline and once in the schedule's local time, and nothing says when the two disagree (feedback 28.10/10b). Make a task that will not generate visible, and ask for the time once."

## User Scenarios & Testing

### User Story 1 - A recurring task that will not generate says so (Priority: P1)

When a recurring task is in a state where it generates no occurrences, the create result and every later read say so, with the reason and what to do.

**Why this priority**: The silent case cost a day of missing records, and the same mistake is easy for any new agent to repeat.

**Independent Test**: Create a recurring task in a non-generating status, read it in every surface, activate it and read it again.

**Acceptance Scenarios**:

1. **Given** a recurring task created in a status where occurrences are not generated, **When** the create response is read, **Then** an advisory (specification 010) says that no occurrences will be generated and what to do next.
2. **Given** the same task, **When** it is read later, alone or in a list, **Then** the advisory is present.
3. **Given** the task is moved to a status where occurrences are generated, **When** it is read again, **Then** the advisory is gone.
4. **Given** a recurring task that is deliberately paused, **When** it is read, **Then** this advisory does not appear, because the pause is visible and intended.
5. **Given** a recurring task with the advisory, **When** a person opens it in the web interface, **Then** the explanation and the next step are shown on the task.

---

### User Story 2 - The time is entered once (Priority: P2)

An agent gives the time of day of a recurring task once. The application derives the second place from the first.

**Why this priority**: Entering the same value twice invites a silent mismatch, and a cold agent cannot tell which one wins.

**Independent Test**: Create recurring tasks with the time given in one place, in both places equal, and in both places different.

**Acceptance Scenarios**:

1. **Given** a request that gives the first deadline but not the schedule's local time, **When** it is accepted, **Then** the local time is taken from the first deadline in the schedule's time zone and the response states the derived value.
2. **Given** both given and equal, **When** the request is accepted, **Then** it behaves as today.
3. **Given** both given and different, **When** the request is accepted as today, **Then** an advisory names both times and says which one later occurrences use.
4. **Given** a time that is repeated or does not exist in the local time zone, **When** the local time would be derived, **Then** the request is rejected as today, and the response asks for an unambiguous time or offset.

### Edge Cases

- The same rules apply when the schedule of an existing recurring task is changed.
- A recurring task in a status that is not generating because of a workflow rule of the project, not because of a draft, gets the same advisory with its own reason.
- A task with the advisory that is archived or cancelled does not raise it, because nothing is expected of it.
- No request that is accepted today is rejected after this change.
- Derived values are shown to people exactly as given values are.

## Requirements

### Functional Requirements

- **FR-001 - Not-generating advisory**: A recurring task that will not generate occurrences MUST carry an advisory at creation and on every read, stating the reason and the next step.
- **FR-002 - Deliberate states excluded**: A deliberately paused, archived or cancelled recurring task MUST NOT raise this advisory.
- **FR-003 - Gone when fixed**: The advisory MUST disappear as soon as the task generates occurrences.
- **FR-004 - Visible to people**: The advisory MUST be visible on the task in the web interface.
- **FR-005 - Derive local time**: When the schedule's local time is omitted, it MUST be derived from the first deadline in the schedule's time zone, and the response MUST state the derived value.
- **FR-006 - Mismatch advisory**: When both times are given and differ, the request MUST still be accepted as today, with an advisory naming both times and the one that later occurrences use.
- **FR-007 - Ambiguous times**: A repeated or nonexistent local time MUST still be rejected as today.
- **FR-008 - Compatibility**: No request accepted today MUST be rejected, existing responses and exit statuses MUST stay as they are, and additions MUST follow the way specification 010 reaches clients.

### Key Entities

- **Generation state**: Whether a recurring task currently produces occurrences, and if not, why.
- **Schedule time**: The local time of day at which occurrences fall, given by the schedule.
- **First deadline**: The deadline of the first occurrence, which may be a different time on purpose.

## Success Criteria

### Measurable Outcomes

- **SC-001**: In 100% of prepared cases where a recurring task will not generate, the create response and every read carry the advisory, and in 0 cases where it generates or is deliberately paused.
- **SC-002**: A recurring task can be created with its time given once, in 1 place instead of 2.
- **SC-003**: 0 requests that are accepted today are rejected after this change.
- **SC-004**: 100% of advisories and derived values are visible to a person in the web interface.

## Assumptions

- The advisory mechanism is specification 010. These advisories reach clients as decided there on 2026-11-16 (FR-009): in the structured response, only when they apply, with the change announced.
- Creating recurring tasks as active by default, which the agent also suggested, is out of scope: statuses are chosen per project and an active status may not exist in every workflow. The owner may revisit this.
- The first deadline may differ from the schedule time on purpose, for example to start a cycle off-pattern; this is why a mismatch is advised and not rejected.
- Source feedback items: 3.11/8, 28.10/10b.
