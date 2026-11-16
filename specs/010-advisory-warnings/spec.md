# Feature Specification: Advisory warnings in responses

**Feature**: `010-advisory-warnings`
**Created**: 2026-11-09
**Status**: Draft

**Input**: User description: "Some conditions do not stop a request but change what an AI agent should do next: a recurring task created as a draft silently generates no occurrences, and a stopped background worker makes lists look complete when they are not (feedback 3.11/8, 8.11/9). Today a request either fails or succeeds silently, so the application has no way to say 'this worked, but look here'. Give successful responses a way to carry short advisories that agents and people can act on, without breaking existing clients."

## Clarifications

### Session 2026-11-16

- Q: How should advisories reach agents: only on request, in the structured response whenever there is something to say, or only as text on the diagnostic output? → A: In the structured response whenever there is something to say and only then (option B). The change is announced, the clients in this repository are updated in the same change, and a third-party client that rejects unknown content may need an update. (FR-009)

## User Scenarios & Testing

### User Story 1 - An agent sees an advisory next to a successful result (Priority: P1)

When a request succeeds but a condition matters for what comes next, the response says so in a short, structured advisory.

**Why this priority**: Without it the application can only stay silent, and agents learn about such conditions days later from missing data.

**Independent Test**: Trigger a known advisory condition and read the response in both output modes.

**Acceptance Scenarios**:

1. **Given** a successful request that triggers an advisory condition, **When** the agent reads the response, **Then** it contains an advisory with a stable identifier, a one-line explanation and a pointer to the remedy, and the result, the exit status and the stored data are exactly what they would be without the advisory.
2. **Given** a request for which no advisory condition applies, **When** the response is read, **Then** it contains no advisory.
3. **Given** several conditions at once, **When** the response is read, **Then** the advisories come in a stable order, their number is bounded, and the response says how many were left out.
4. **Given** the same condition on many items of one list, **When** the response is read, **Then** the advisory is reported once with a count and not once per item.

---

### User Story 2 - A condition that persists is advised on every read (Priority: P1)

An advisory is not a one-time message at the moment of a write. As long as the condition holds, every read of the item concerned carries it.

**Why this priority**: The reported draft case was noticed a day later, on a read, long after the write that created it.

**Independent Test**: Create the condition, read the item several times, remove the condition and read again.

**Acceptance Scenarios**:

1. **Given** a condition that persists, **When** the concerned item is read later, alone or in a list, **Then** the advisory is present.
2. **Given** the condition is removed, **When** the item is read again, **Then** the advisory is gone.

---

### User Story 3 - People see the same advisories (Priority: P2)

An advisory about an item is visible to a person in the web interface wherever that item is shown.

**Why this priority**: The person must see everything the agent sees.

**Independent Test**: Trigger an advisory and open the item in the web interface.

**Acceptance Scenarios**:

1. **Given** an item with an advisory, **When** a person opens it in the web interface, **Then** the explanation and the remedy are shown on the item.
2. **Given** human-readable command output, **When** an advisory applies, **Then** it is shown as a plain text line on the diagnostic output, and the main output is unchanged.

---

### User Story 4 - Existing clients are not broken (Priority: P1)

Programs that read today's responses keep working, or are given a defined transition.

**Why this priority**: The contract is strict, and breaking wrappers silently would cost more than the advisories save. The policy for changing it must be explicit.

**Independent Test**: Run existing contract checks and a client that knows only today's fields against the new behavior.

**Acceptance Scenarios**:

1. **Given** a client that knows only today's response fields, **When** it reads a response to which no advisory applies, **Then** the response is exactly as today.
2. **Given** the same client, **When** a response carries an advisory, **Then** the change log and the compatibility documentation have stated in advance that this content may appear, which clients may need an update and how.
3. **Given** the web interface and every other client in this repository, **When** a response carries an advisory, **Then** they accept it and keep working.
4. **Given** the documentation, **When** an agent reads it, **Then** it states how advisories reach the agent and which clients may need an update.

### Edge Cases

- Advisories never turn a success into a failure and never change the exit status.
- Computing an advisory never writes anything.
- Error responses are not advisories; their content is specified in specification 004.
- Advisory text is English, bounded in length, and never contains values taken from the request, secrets or storage errors.
- A new advisory identifier is added only together with its documentation entry.

## Requirements

### Functional Requirements

- **FR-001 - Advisory content**: Each advisory MUST have a stable identifier, a one-line explanation and a pointer to the remedy.
- **FR-002 - Non-fatal**: An advisory MUST NOT change the result, the exit status or any stored data.
- **FR-003 - Catalogue**: The documentation MUST list every advisory identifier with its meaning and remedy, and an advisory without a documentation entry MUST fail the acceptance checks.
- **FR-004 - Bounds and repetition**: Advisories MUST come in a stable order, MUST be bounded in number with the omitted count stated, and MUST be reported once with a count when the same condition applies to many items.
- **FR-005 - Persistent conditions**: A condition that persists MUST be advised on every read of the item concerned.
- **FR-006 - Same for people**: An advisory about an item MUST be visible in the web interface wherever the item is shown.
- **FR-007 - Human-readable mode**: In human-readable mode advisories MUST appear as plain text lines on the diagnostic output and MUST NOT change the main output.
- **FR-008 - Safety**: Advisories MUST NOT contain values taken from the request, secrets or storage errors.
- **FR-009 - Reaching clients**: Advisories MUST be part of the structured response whenever an advisory condition applies, and only then; a response without advisories MUST be exactly as today. The change MUST be announced in the change log and the compatibility documentation, stating which clients may need an update and how, and every client in this repository, including the web interface, MUST accept the new content in the same change.
- **FR-010 - Mechanism, not conditions**: This feature MUST provide the mechanism; the conditions that raise advisories are defined by the features that use it.

### Key Entities

- **Advisory**: A short, structured, non-fatal message attached to a successful response or to a read of an item.
- **Advisory catalogue**: The documented list of advisory identifiers with meaning and remedy.

## Success Criteria

### Measurable Outcomes

- **SC-001**: For each documented advisory condition, an agent that receives the response can identify the condition and the remedy without any further request.
- **SC-002**: 100% of advisory identifiers have a catalogue entry.
- **SC-003**: 0 changes to results, exit statuses and stored data caused by advisories; existing contract checks stay green for responses without advisories, and checks for responses with advisories are added in the same change (FR-009).
- **SC-004**: 100% of advisories about an item are visible to a person where the item is shown in the web interface.

## Assumptions

- This feature ships together with at least one of its users, the advisories of specifications 011 and 012; on its own it has no condition to report.
- Error responses stay as specified in specification 004.
- The product's contract rules require an explicit version or transition policy for any change that can break existing clients; the owner chose an announced change (FR-009, Clarifications 2026-11-16).
- Specification 004 keeps every success response unchanged; this feature is the one place where success responses gain content, and only when an advisory applies.
- Source feedback items: 3.11/8, 8.11/9; the mechanism was identified in the developer-experience review of 2026-11-09 as the shared basis for the worker and draft warnings.
