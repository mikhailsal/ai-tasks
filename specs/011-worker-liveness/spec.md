# Feature Specification: Background worker liveness

**Feature**: `011-worker-liveness`
**Created**: 2026-11-09
**Status**: Draft

**Input**: User description: "After three reboots the background worker was not running and nothing said so: the occurrence list of a daily habit simply ended at the previous day, and the AI agent could not tell 'no task today' from 'the service is down' (feedback 8.11/9). Let agents and people see whether the worker is alive, and warn when a read may be incomplete because it is not."

## User Scenarios & Testing

### User Story 1 - Anyone can tell whether the worker is alive (Priority: P1)

For each project the application reports when the worker last processed it and a plain status: healthy, stale or never.

**Why this priority**: The agent found out only after a human noticed missing occurrences, and then checked processes by hand.

**Independent Test**: Run the worker, stop it, wait past the tolerance, and read the status at each point.

**Acceptance Scenarios**:

1. **Given** a worker that processed a project recently, **When** the status is read, **Then** it says healthy and shows the time of the last pass.
2. **Given** a worker that has not processed a project for longer than the tolerance, **When** the status is read, **Then** it says stale, since when, and where to find how to start the service.
3. **Given** a project that no worker has ever processed, **When** the status is read, **Then** it says never, which is distinct from stale.
4. **Given** the worker resumes after a stop, **When** the status is read again, **Then** it is healthy.

---

### User Story 2 - Reads that depend on the worker say when they may be incomplete (Priority: P1)

When the worker is stale, reading occurrences or recurring tasks carries an advisory that the list may be incomplete.

**Why this priority**: This is the exact moment of the original mistake: a list that looked complete but ended a day early.

**Independent Test**: Stop the worker past the tolerance and read occurrences of a daily task.

**Acceptance Scenarios**:

1. **Given** a stale worker, **When** an agent reads occurrences or recurring tasks, **Then** the response carries an advisory (specification 010) that the data may be incomplete since the time of the last pass, with the remedy.
2. **Given** a healthy worker, **When** the same reads are made, **Then** no such advisory appears.
3. **Given** a project without any recurring task, **When** it is read while the worker is stale, **Then** no advisory appears because nothing depends on the worker.

---

### User Story 3 - People see the same warning (Priority: P2)

A person using the web interface sees that the worker is stale or has never run, on the project and on the screens that depend on it.

**Why this priority**: The person owns the service and must see what the agent sees.

**Independent Test**: Stop the worker past the tolerance and open the web interface.

**Acceptance Scenarios**:

1. **Given** a stale or never-run worker, **When** a person opens a project in the web interface, **Then** a visible notice says so, with the last pass time and the remedy.
2. **Given** a healthy worker, **When** the same screen is opened, **Then** no notice is shown.

### Edge Cases

- A database restored from a backup shows the restored last pass time and is stale until the worker runs again.
- Several projects can have different statuses; each is reported on its own.
- A paused project follows the same status rule; the notice explains that pause does not stop the worker.
- A clock change does not cause a false stale status.
- Reading the status never starts or stops anything.
- The worker catching up after a stop, which already happens today, is unchanged; the status becomes healthy as soon as a pass completes.

## Requirements

### Functional Requirements

- **FR-001 - Record last pass**: The application MUST record when the worker last completed a pass for each project.
- **FR-002 - Status**: The application MUST report, per project, the time of the last pass and a status of healthy, stale or never, in the information an agent reads first and in project reads.
- **FR-003 - Tolerance**: A project is stale when no pass has completed for longer than a documented tolerance. The tolerance is the same on every surface, and a stopped worker MUST be reported stale within a bounded time after the tolerance expires.
- **FR-004 - Advisory on dependent reads**: When the worker is stale or has never run, reads of occurrences and of recurring tasks of that project MUST carry an advisory (specification 010) that names the last pass time and the remedy.
- **FR-005 - Notice for people**: The web interface MUST show a visible notice for a stale or never-run worker on the project and on screens that depend on it.
- **FR-006 - Remedy**: The status, the advisory and the notice MUST point to the documented way to start the service.
- **FR-007 - No side effects**: Reading the status MUST NOT start, stop or change the worker.
- **FR-008 - Compatibility**: Existing responses and exit statuses MUST stay as they are, and additions MUST follow the way specification 010 reaches clients.

### Key Entities

- **Last pass**: The time at which the worker last completed processing of a project.
- **Worker status**: Healthy, stale or never, derived from the last pass and the tolerance.
- **Tolerance**: The documented time after which a missing pass counts as stale.

## Success Criteria

### Measurable Outcomes

- **SC-001**: After a worker is stopped, the status becomes stale within the documented tolerance plus a bounded delay stated in the plan.
- **SC-002**: In 100% of prepared cases an agent can tell "no occurrence today" from "worker stale" in one request.
- **SC-003**: 100% of stale or never-run cases show the notice in the web interface.
- **SC-004**: 0 false stale reports while a healthy worker keeps passing, in a prepared scenario of at least 100 passes including a clock change.

## Assumptions

- Starting the service at boot stays outside the application. The documentation of specification 004 carries an optional example; this feature only reports the state.
- The tolerance is related to how often the worker is expected to pass and to the shortest confirmation window in the project; the plan fixes the exact value and documents it.
- Source feedback items: 8.11/9 (b); part (a), starting the service at boot, is covered by the documentation in specification 004.
