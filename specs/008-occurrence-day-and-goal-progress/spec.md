# Feature Specification: Occurrence day, recorded values and goal progress

**Feature**: `008-occurrence-day-and-goal-progress`
**Created**: 2026-11-09
**Status**: Draft

**Input**: User description: "A habit goal such as '6 nights of 7 for 4 weeks' needs three things the application does not give an AI agent: a clear answer to 'which day does this occurrence belong to' for evening and night occurrences, a place for measured values (time asleep, time up), and a count of how many occurrences succeeded in a window. Today the agent derives the day with a private rule, keeps the values in its notes and counts the goal by hand every night (feedback 9.11/13, 9.11/15). Give the application these three things."

## User Scenarios & Testing

### User Story 1 - Every occurrence belongs to a day the project defines (Priority: P1)

Each project says where its day begins. Every occurrence then has a day, shown to people and usable for filtering, so that a night occurrence with a deadline after midnight belongs to the day it is about.

**Why this priority**: The other two stories and the completion shortcut of specification 009 depend on a stable answer to "which day".

**Independent Test**: Create occurrences around the day boundary and read their days.

**Acceptance Scenarios**:

1. **Given** a project whose day begins at 06:00 local time, **When** an occurrence has its deadline at 01:30 on 9 November, **Then** its day is 8 November.
2. **Given** a project that has not chosen where its day begins, **When** an occurrence is read, **Then** its day is the local calendar day of its deadline.
3. **Given** a deadline exactly at the start of the day, **When** its day is determined, **Then** it belongs to the day that starts there.
4. **Given** any list or detail view of occurrences in the web interface or in command output, **When** it is displayed, **Then** the day is shown, and occurrences can be filtered by a day or a range of days.
5. **Given** the project changes where its day begins, **When** occurrences already exist, **Then** their days do not change; only occurrences created later use the new rule.

---

### User Story 2 - Record measured values on an occurrence (Priority: P2)

A recurring task can declare named values to record, and a completion can carry them, for example the time the person fell asleep and the time they got up.

**Why this priority**: A goal about times is not a checkbox. Without a place for the values the agent keeps them in private notes.

**Independent Test**: Declare a value, complete an occurrence with it, and read it back in every surface.

**Acceptance Scenarios**:

1. **Given** a recurring task that declares a value with a name and a kind (a number, a time of day or a duration), **When** an agent completes an occurrence and supplies the value, **Then** the value is stored with the completion and shown wherever the completion is shown.
2. **Given** a supplied value of the wrong kind, **When** the completion is submitted, **Then** it is rejected and the response names the declared kind.
3. **Given** a completion without values, **When** it is submitted, **Then** it is accepted: values are optional.
4. **Given** a completion with a value that the task does not declare, **When** it is submitted, **Then** it is rejected and the response lists the declared values.

---

### User Story 3 - See goal progress for a window (Priority: P2)

For a recurring task and a window of days, the application reports how many occurrences succeeded out of how many were decided, so that nobody counts by hand.

**Why this priority**: The agent reported counting "2 of 11" by hand every night from its own notes.

**Independent Test**: Prepare a week of occurrences with known outcomes and compare the reported counts.

**Acceptance Scenarios**:

1. **Given** a window of 7 days with 5 completed on time, 1 completed after its window, 1 missed and none owed, **When** progress is requested, **Then** it reports 6 done out of 7 decided, with the breakdown by outcome.
2. **Given** occurrences in the window that are still open, **When** progress is requested, **Then** they are reported separately and counted neither as done nor as not done.
3. **Given** a window without occurrences, **When** progress is requested, **Then** it reports 0 of 0 without an error.
4. **Given** the same task, **When** a person opens it in the web interface, **Then** the same progress is shown for the same window.

### Edge Cases

- The day rule uses the project's time zone, including days that have 23 or 25 hours.
- Cancelled occurrences are excluded from the counts.
- Owed occurrences count as decided and not done until they are completed.
- A completion recorded after the window counts as done, because the work was done; its late recording is reported in the breakdown.
- A window may reach back before the first occurrence; only existing occurrences are counted.
- A value of kind time of day carries no date; its day is the occurrence's day.
- Progress for a window is computed from the days of the occurrences, so a changed day rule never rewrites past counts.

## Requirements

### Functional Requirements

- **FR-001 - Day rule**: A project MUST be able to choose at which local hour its day begins, with the start of the calendar day as the default.
- **FR-002 - Day of an occurrence**: Every occurrence MUST have a day determined by the project's rule from its deadline, shown in the web interface and in command output, and usable as a filter.
- **FR-003 - History is stable**: Changing the day rule MUST NOT change the day of any existing occurrence.
- **FR-004 - Declared values**: A recurring task MUST be able to declare named values of kind number, time of day or duration, and a completion MUST be able to carry them. Values are optional on every completion.
- **FR-005 - Value visibility**: Recorded values MUST be visible wherever the completion is shown, in the web interface and in command output.
- **FR-006 - Value errors**: A wrong kind or an undeclared value MUST be rejected with the declared values and kinds listed.
- **FR-007 - Progress report**: For a recurring task and a window of days, the application MUST report the number done, with the breakdown by outcome, the number missed, the number owed and the number still open, and the total decided.
- **FR-008 - Progress parity**: The web interface MUST show the same progress as command output for the same window.
- **FR-009 - Compatibility**: Existing responses and exit statuses MUST stay as they are. Additions MUST be tolerated by programs that know only today's fields. No input becomes newly required.

### Key Entities

- **Occurrence day**: The calendar day an occurrence belongs to under its project's day rule. Stored once and never rewritten.
- **Day rule**: The local hour at which a project's day begins.
- **Recorded value**: A named, typed measurement attached to a completion.
- **Goal progress**: Counts of occurrences by outcome over a window of days.

## Success Criteria

### Measurable Outcomes

- **SC-001**: On a fixed set of at least 10 boundary cases, including a day with 23 hours and a day with 25 hours, 100% of occurrences land on the day a person expects under the project's rule.
- **SC-002**: The reported goal question "how many nights out of 7" is answered by one request and matches a manual count in 100% of prepared cases.
- **SC-003**: 100% of recorded values and the progress counts are visible to a person in the web interface.
- **SC-004**: 0 changes to existing outputs apart from additions tolerated by existing clients.

## Assumptions

- The target of a goal (for example 6 of 7 for 4 weeks) stays in the task's own text. The application reports progress and does not store or enforce targets.
- Success means completed, whether on time or recorded after the window. Thresholds on recorded values, such as asleep before a given time, are not evaluated; values are recorded and shown only.
- The day rule belongs to the project, not to a single recurring task.
- The web interface only reads these data; recording values from the web interface is out of scope.
- Specification 009 uses the occurrence day to name an occurrence; until this feature ships, that specification falls back on the local calendar day of the deadline, which equals the default rule here.
- Source feedback items: 9.11/13, 9.11/15.
