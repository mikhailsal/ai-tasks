# Feature Specification: Reasons and notes on occurrence outcomes

**Feature**: `007-occurrence-reasons-and-notes`
**Created**: 2026-11-09
**Status**: Draft

**Input**: User description: "An AI agent often learns the real outcome of a recurring task from the person ('he said no', 'my estimate, he gave no time', 'was not done'), but the record has no place for it. A completion takes no note. A miss cannot carry a reason and cannot be declared before the window closes. An owed occurrence can only be completed, so the agent had to mark six not-done days as completed late to clear them (feedback 28.10/13, 28.10/15, 9.11/11, 9.11/12). Let outcomes carry a short reason or note, and let an agent record a miss as soon as the person says no."

## Clarifications

### Session 2026-11-16

- Q: When the person decides that an occurrence will not be made up, may an agent record it as a miss with a required reason, also for an occurrence that is already owed and for tasks that carry misses forward as debt? → A: Yes (option a). The reason is required, the original miss stays in history, and the occurrence stops being owed. This relaxes the rule of specification 001 that owed work leaves the owed state only by completion. (FR-003)
- Q: Should the case reported on 11 Nov (a retired recurring task that cannot be archived because of an old owed occurrence) be covered here or in a new specification? → A: Here, as part of User Story 3; the request that refusals name every blocker at once goes to specification 004 (FR-023 there). (FR-011)

## User Scenarios & Testing

### User Story 1 - Record a miss with a reason as soon as the person says no (Priority: P1)

When the person says that an occurrence will not be done, the agent records a miss with the reason right away, without waiting for the window to close.

**Why this priority**: The reason is the useful part for a habit, and today it is lost: the automatic miss at the end of the window looks the same as "nobody asked".

**Independent Test**: With a pending occurrence whose window is still open, record a miss with a reason and read the occurrence in every surface.

**Acceptance Scenarios**:

1. **Given** a pending occurrence whose window is still open, **When** an agent records a miss with a reason, **Then** the occurrence becomes missed immediately and carries the reason and the time it was recorded.
2. **Given** a miss recorded this way, **When** the window later closes, **Then** nothing changes: the occurrence stays missed with the same reason.
3. **Given** a miss recorded without a reason, **When** it is read, **Then** it is shown as missed without a reason (a reason is optional).
4. **Given** an occurrence that is already completed or cancelled, **When** an agent tries to record a miss, **Then** the request is rejected and the response names the current state and the next step.
5. **Given** an occurrence that is already missed without a reason, **When** an agent records a miss with a reason, **Then** the reason is added to the existing miss and no second miss is created.
6. **Given** a missed occurrence, **When** the work is done after all, **Then** it can still be completed, and the history keeps both the miss with its reason and the completion.

---

### User Story 2 - Add a note to a completion (Priority: P1)

An agent can attach a short note to a completion, for example to say that the completion time is an estimate.

**Why this priority**: The recorded completion time is stored as fact. An estimate or a caveat currently lives only in the agent's private notes.

**Independent Test**: Complete an occurrence with a note and read it in every surface.

**Acceptance Scenarios**:

1. **Given** a pending, missed or owed occurrence, **When** an agent completes it with a note, **Then** the note is stored with the completion and shown wherever the completion is shown.
2. **Given** a completion without a note, **When** it is read, **Then** it looks as it does today.
3. **Given** a note that is empty after trimming or longer than the allowed length, **When** it is submitted, **Then** the request is rejected and the response states the rule.

---

### User Story 3 - Close an owed occurrence without calling it done (Priority: P2)

When the person decides that an owed occurrence will not be made up, the agent can close it as missed with a reason, instead of recording a false completion. The owner chose this behavior on 2026-11-16 (FR-003).

**Why this priority**: Without it, the only way to clear a day that was known not to be done is to record it as completed, which falsifies the record. The same falsification is today the only way to archive a recurring task that the person has retired while an old owed occurrence remains.

**Independent Test**: With an owed occurrence, close it as missed with a reason and read its history.

**Acceptance Scenarios**:

1. **Given** an owed occurrence, **When** an agent closes it as missed with a reason, **Then** it becomes missed, the reason and time are recorded, and the original miss stays in its history.
2. **Given** such an occurrence, **When** the work is done later, **Then** it can still be completed.
3. **Given** an owed occurrence, **When** an agent tries to close it as missed without a reason, **Then** the request is rejected and the response says that a reason is required for this action.
4. **Given** a task that carries misses forward as debt and an owed occurrence closed as missed with a reason, **When** later deadlines pass, **Then** that occurrence stays missed and does not become owed again.
5. **Given** a recurring task that the person has retired, which is paused, has no pending occurrence left and still has one owed occurrence from an earlier day, **When** an agent closes that occurrence as missed with a reason and then archives the task, **Then** the archive succeeds and no completion is recorded for the owed day.

---

### User Story 4 - People see the same reasons and notes (Priority: P2)

Everything an agent records as a reason or a note is visible to the person in the web interface and in human-readable output.

**Why this priority**: The person must see everything the agent sees, and the reason is meant for them.

**Independent Test**: Record a reason and a note, then read the occurrence in the web interface and in human-readable output.

**Acceptance Scenarios**:

1. **Given** an occurrence with a reason or a note, **When** a person views its details in the web interface, **Then** the reason or note is shown next to the outcome.
2. **Given** the same occurrence, **When** a person reads human-readable command output for its details or history, **Then** the same text is shown.

### Edge Cases

- A reason or a note is plain text. It is stored and shown as typed and is never interpreted.
- A reason or a note is not editable once it is recorded; it can be added only where none exists, and the history is append-only.
- Recording the same miss or the same note-bearing completion twice, for example after an uncertain outcome, changes nothing the second time and says that the existing record was returned.
- A miss recorded for an occurrence of a recurring task that is paused or archived follows the existing rules for those states.
- The automatic miss at the end of a window is unchanged and carries no reason.
- On a task that carries misses forward as debt, a miss recorded by an agent declines the make-up work, so it always requires a reason (FR-003); the automatic miss at the end of a window still becomes owed as today.

## Requirements

### Functional Requirements

- **FR-001 - Miss with reason**: An agent MUST be able to record a miss for a pending occurrence at any time before its window closes, optionally with a reason. The occurrence becomes missed immediately and a later expiry MUST NOT change it. The same action MUST add a reason to an occurrence that is already missed without one.
- **FR-002 - Note on completion**: A completion MUST accept an optional note, stored with the completion and shown wherever the completion is shown.
- **FR-003 - Declining make-up work**: When the person decides that an occurrence will not be made up, an agent MUST be able to record it as missed with a required reason, also for an occurrence that is already owed and for a task that carries misses forward as debt. The occurrence then stops being owed and MUST NOT become owed again, and its original miss MUST stay in its history. On a task that carries misses forward, a miss recorded by an agent MUST require a reason.
- **FR-004 - Text rules**: A reason or a note MUST be plain text, non-empty after trimming, and no longer than a stated limit. The same rules apply to both.
- **FR-005 - Visibility**: Reasons and notes MUST be visible in the web interface and in human-readable and machine-readable output wherever the outcome is shown.
- **FR-006 - History kept**: When an occurrence has both a miss and a later completion, the record MUST show both with their reasons or notes.
- **FR-007 - Clear refusals**: A request that cannot be applied because of the occurrence's state MUST be rejected with the current state and the next step named.
- **FR-008 - Repeat safety**: Repeating the same request after an uncertain outcome MUST NOT duplicate or change anything and MUST say that the existing record was returned.
- **FR-009 - Cancellation refusal points here**: The refusal to cancel an owed occurrence (specification 004, FR-012) MUST name the allowed alternatives, including closing it as missed with a reason (FR-003).
- **FR-010 - Compatibility**: Requests that do not use the new inputs MUST behave as they do today, and no input becomes newly required. Added response content MUST be tolerated by programs that know only today's fields.
- **FR-011 - Retiring with old debt**: An owed occurrence closed under FR-003 MUST NOT block archiving its recurring task. When no other blocker remains, archiving MUST succeed without any completion being recorded for that occurrence.

### Key Entities

- **Reason**: Short text explaining why an occurrence was missed or set aside.
- **Note**: Short text attached to a completion, for example that the time is an estimate.
- **Outcome history**: The ordered record of what happened to an occurrence: expiry, miss, completion, each with its time and text.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Each of these reported cases can be recorded truthfully with one command and no false completion: a day the person declined (with reason), a completion at an estimated time (with note), and a known not-done owed day (with reason).
- **SC-002**: 100% of reasons and notes are visible to a person next to the outcome in the web interface and in human-readable output.
- **SC-003**: 0 changes to existing outputs for requests that do not use the new inputs.
- **SC-004**: A retired recurring task with an old owed occurrence (the case reported on 11 Nov) can be archived with 0 false completions.

## Assumptions

- The automatic miss behavior at the end of a window, the miss policy of recurring tasks and the existing late completion of a missed or owed occurrence stay as they are.
- This feature changes one rule of specification 001: owed work may now also leave the owed state by being closed as missed with a reason, not only by completion. Owed work still cannot be cancelled, and archiving still refuses pending or owed occurrences.
- A precision flag on the completion time is out of scope; the note carries that information.
- Recording reasons and notes from the web interface is out of scope, because the person mostly reads there; the web interface shows them.
- Changing the miss policy of occurrences that already exist (feedback 28.10/14) is out of scope.
- Wording of the late-recording state is specification 006.
- Source feedback items: 28.10/13, 28.10/15, 9.11/11, 9.11/12, 11.11/1.
