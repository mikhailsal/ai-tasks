# Feature Specification: Honest label for late recordings

**Feature**: `006-late-recording-label`
**Created**: 2026-11-09
**Status**: Draft

**Input**: User description: "An AI agent reported three times that the application tells people a daily habit was done late when the work was done on the day and only the report arrived after the confirmation window (feedback 28.10/15, 28.10/17, 8.11/10). By design the state records that the completion was recorded after the window, whatever the actual completion time says. The wording shown to people claims more than that. Make every human-facing wording say what the state really means, without changing the state itself."

## User Scenarios & Testing

### User Story 1 - A person reads an honest label (Priority: P1)

A person looking at an occurrence whose completion was recorded after its confirmation window sees a label that says exactly that, and nothing about when the work itself was done.

**Why this priority**: The person is the owner of the tasks and uses the label to judge their own behavior. A false "done late" for work done on the day is misleading and was reported repeatedly.

**Independent Test**: Record a completion after the window, with an actual completion time inside the window, and read the occurrence in every place a person can see it.

**Acceptance Scenarios**:

1. **Given** an occurrence whose completion was recorded after its window, **When** a person views it in the web interface, **Then** the label says the completion was recorded after the window and does not say or imply that the work was late.
2. **Given** the same occurrence, **When** a person reads human-readable command output (a list or a summary), **Then** the same wording is used, including in summary counts.
3. **Given** any filter, legend, heading, count or tooltip in the web interface or in human-readable command output that names this state, **When** it is displayed, **Then** it uses the same wording.
4. **Given** an occurrence completed after its window whose actual completion time lies inside the window, **When** a person views its details, **Then** both the actual completion time and the recording time remain visible wherever they are visible today.

---

### User Story 2 - The machine-readable meaning does not move (Priority: P1)

Agents and scripts that read the state keep working, and the documentation says what the state means.

**Why this priority**: Wrappers already depend on the state value. Only the wording shown to people was wrong.

**Independent Test**: Compare machine-readable output for the same data before and after the change.

**Acceptance Scenarios**:

1. **Given** an occurrence completed after its window, **When** it is read in machine-readable mode, **Then** the state value and every other field are exactly as before.
2. **Given** the documentation, **When** an agent reads about this state, **Then** it says that the completion was recorded after the confirmation window, that the actual completion time is stored separately, and that the state name is unchanged.

### Edge Cases

- Summary lines that count this state ("N late") use the same new wording.
- An occurrence whose actual completion time is itself after the window still carries the label "recorded after the window", which is true; the actual time stays visible in the details. A finer label is a possible follow-up.
- Sorting and filtering by this state work as before.
- Documentation, screenshots and existing checks that quote the old wording are updated together with the wording.
- The machine-readable state name keeps its current English spelling; only text for people changes.

## Requirements

### Functional Requirements

- **FR-001 - Honest wording**: Every place where a person sees this state MUST describe it as a completion recorded after the confirmation window and MUST NOT say or imply that the work itself was late.
- **FR-002 - One wording**: The web interface and human-readable command output MUST use the same wording, including filters, legends, counts and headings.
- **FR-003 - Nothing hidden**: The actual completion time and the recording time MUST remain visible wherever they are visible today.
- **FR-004 - Machine-readable output unchanged**: The state value, all other fields, ordering and exit statuses MUST stay as they are.
- **FR-005 - Documentation**: The documentation MUST explain the meaning of the state and that its name is unchanged, and MUST NOT quote the old wording.
- **FR-006 - Stored data unchanged**: No stored data changes; the change is limited to what is shown.

### Key Entities

- **Late-recording state**: The state of an occurrence whose completion was recorded after its confirmation window. It does not say when the work was done.
- **Actual completion time**: When the work was done, as reported. Stored separately from the recording time.
- **Recording time**: When the completion was written down.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 0 occurrences of the old wording remain in the web interface, in human-readable command output and in the documentation.
- **SC-002**: 0 changes to machine-readable output; existing contract checks stay green.
- **SC-003**: For a completion recorded after the window with an in-window actual time, none of the texts a person sees for it claim anything about when the work was done.

## Assumptions

- The meaning follows the product's own rule that backdating the actual completion time does not make a late recording timely (specification 001). This feature aligns the wording with that rule and does not change the rule.
- The proposed wording in the Russian interface is «Записано после окна». The owner may adjust the exact words at review without changing this specification.
- A finer label that separates work done on time but reported late from work really done late, using the two stored times, is a possible follow-up and is not part of this feature.
- The web interface is read-only for this state; no new controls are added.
- Source feedback items: 28.10/15, 28.10/17, 8.11/10.
