# Feature Specification: Self-describing commands

**Feature**: `005-self-describing-commands`
**Created**: 2026-11-09
**Status**: Draft

**Input**: User description: "AI agents are the primary users of the command interface and they learn it by failing. The only built-in help is the usage text of the whole interface. Make every command describe itself in machine-readable form: what it does, what input it takes, which revision values it needs and where to get each, and one ready, runnable example. The description must not be able to disagree with the real behavior. The owner chose this during the developer-experience review of 2026-11-09 as the main way for a cold agent to reach its first successful request."

## User Scenarios & Testing

### User Story 1 - An agent asks one command how to use it (Priority: P1)

An agent that knows a command's name asks that command for its help in machine-readable mode and gets everything needed to build a valid request: the purpose, the input fields, the revision values with their sources, and a ready example.

**Why this priority**: This is the first-request gate. Today an agent builds its first request from documentation and learns the rest from rejections, one missing value at a time.

**Independent Test**: For each command, a reader who sees only its help builds a request that is accepted on the first attempt on a scratch database with one existing project.

**Acceptance Scenarios**:

1. **Given** any command, **When** an agent asks for its help in machine-readable mode, **Then** the response states the command's purpose in one sentence, every input field with its type and whether it is required, and every accepted alternative way of providing the input.
2. **Given** a command that changes data, **When** its help is read, **Then** it lists each required revision value together with the command or place that supplies it.
3. **Given** a field with a fixed set of allowed values, **When** the help is read, **Then** the allowed values are listed. **Given** a field whose allowed values depend on the project's configuration, **Then** the help says where to read them.
4. **Given** a command that reads data, **When** its help is read, **Then** it states how the scope is chosen (one project or all projects).
5. **Given** a command that takes no input, **When** its help is read, **Then** it says that no input is needed.
6. **Given** any command, **When** its help is read, **Then** it contains one ready example request.

---

### User Story 2 - The help cannot disagree with the real behavior (Priority: P1)

Whatever the help says is true: if the interface changes, the help changes with it or the release is blocked.

**Why this priority**: A help that is sometimes wrong is worse than no help, because agents trust it and stop checking.

**Independent Test**: Introduce deliberate disagreements (rename a field, change a required value, break an example) and confirm that the acceptance checks catch each one.

**Acceptance Scenarios**:

1. **Given** a command whose help lists a field the command rejects, omits a field the command requires, or states a wrong type or requirement, **When** the acceptance checks run, **Then** they fail.
2. **Given** a command whose help names a revision value the command does not require, or omits one it does, **When** the acceptance checks run, **Then** they fail.
3. **Given** every example in every help, **When** the acceptance checks run on a scratch database, **Then** every example succeeds once its placeholders are replaced by values from the sources the help names.
4. **Given** a new command without help, **When** the acceptance checks run, **Then** they fail.
5. **Given** the same build, **When** the help of one command is requested twice, **Then** both responses are identical.

---

### User Story 3 - An agent finds the right command (Priority: P2)

An agent that does not yet know the command names lists them with their purposes and drills into the one it needs.

**Why this priority**: Knowing that a command exists comes before knowing how to use it.

**Independent Test**: Starting from the help of the whole interface, a reader reaches the help of any given command in at most two requests.

**Acceptance Scenarios**:

1. **Given** the help of the whole interface in machine-readable mode, **When** it is read, **Then** it lists every command with a one-line purpose, grouped as the commands are grouped, and it still carries the existing usage text unchanged.
2. **Given** a group of commands, **When** the group's help is requested, **Then** it lists the members with their purposes.
3. **Given** a mistyped command name, **When** its help is requested, **Then** the rejection offers the nearest valid names, as specified for rejections in specification 004.

---

### User Story 4 - Help and rejections tell the same story (Priority: P2)

When a request is rejected, the rejection and the command's help agree on where missing values come from and which values are allowed.

**Why this priority**: Two sources that disagree make an agent distrust both.

**Independent Test**: For a set of representative rejections, compare the rejection with the help of the same command.

**Acceptance Scenarios**:

1. **Given** a change request rejected for missing revision values, **When** the rejection is compared with the command's help, **Then** both name the same sources for the same values.
2. **Given** a rejection for a value outside a fixed set, **When** it is compared with the command's help, **Then** the allowed values match.

### Edge Cases

- Help works when no database exists, when the service is not running and without any side effect: the first request of a cold agent may come before any setup.
- The existing human-readable usage text stays available and unchanged.
- A command that accepts its input either as a file or as separate options is described in both forms, and the help states that the forms are equivalent.
- A command that takes a list of items (for example several occurrences in one request) describes the fields of one item and says that the item may repeat.
- A field whose allowed values depend on configuration cannot list them; it points to where they can be read (User Story 1, scenario 3).
- A request for help on an unknown command is rejected with the nearest valid names and never returns the help of a different command.

## Requirements

### Functional Requirements

- **FR-001 - Per-command help**: For every command, the interface MUST provide machine-readable help stating its purpose in one sentence, each input field with its type and whether it is required, and each accepted alternative way of providing the input.
- **FR-002 - Revision values**: The help of a command that changes data MUST list each required revision value and the command or place that supplies it.
- **FR-003 - Allowed values**: The help MUST list the allowed values of a field with a fixed set and MUST say where to read the allowed values of a field that depends on project configuration.
- **FR-004 - Ready example**: The help of every command MUST contain one example request that succeeds on a scratch database once its placeholders are replaced by values from the sources the help names.
- **FR-005 - Scope**: The help of a read command MUST state how the scope is chosen.
- **FR-006 - Coverage**: Every command MUST have help, and a command without help MUST fail the acceptance checks.
- **FR-007 - No disagreement**: The acceptance checks MUST fail when the help disagrees with the command's behavior about fields, types, requirements, revision values or allowed values, or when an example fails.
- **FR-008 - Whole-interface and group help**: The help of the whole interface and of each group of commands MUST list the commands or members with one-line purposes. The existing usage text MUST remain available in the place where it is available today.
- **FR-009 - Independence**: Help MUST work without a database and without a running service, MUST have no side effects, and MUST be identical across requests on the same build.
- **FR-010 - Consistency with rejections**: A rejection and the help of the same command MUST name the same sources for the same revision values and the same allowed values (specification 004, FR-005 and FR-007).
- **FR-011 - Unknown command**: A help request for an unknown command MUST be rejected with the nearest valid names offered, drawn only from known names.
- **FR-012 - Compatibility**: Existing responses, exit statuses, error codes and the human-readable help MUST stay unchanged. Any addition MUST be tolerated by a program that knows only today's fields. No input becomes newly required.

### Key Entities

- **Command description**: The machine-readable help of one command: purpose, input fields, alternative input forms, revision values with their sources, and one ready example.
- **Input field**: A named piece of input with a type, a requirement status, and either its allowed values or where to read them.
- **Revision value source**: The command or place that returns a revision value the agent must send back.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of commands have help, and 100% of the examples in them succeed on a scratch database.
- **SC-002**: 100% of deliberately introduced disagreements between help and behavior (a renamed field, a changed requirement, a missing revision value, a broken example) are caught by the acceptance checks.
- **SC-003**: In a walkthrough like the one in specification 004, a cold agent that is allowed to use only the machine-readable help creates its first task and sees it in the task list with 0 rejected requests.
- **SC-004**: A help request succeeds with no database present in 100% of commands.
- **SC-005**: 0 changes to existing responses, exit statuses, error codes and human-readable help; existing contract checks stay green.

## Assumptions

- Primary users are AI agents using the command interface. The web interface has no help and is unaffected; the human's parity with the agent concerns the data both see, not the help.
- The help describes input, not output. The only output information it gives is where a revision value is found in the response of the command that supplies it.
- A single request that returns the descriptions of all commands is out of scope; it is a possible follow-up if agents ask for it.
- Messages and descriptions stay in English, as today.
- This feature and specification 004 can ship in either order. Their consistency requirement (FR-010) applies to whatever has shipped, and acceptance of FR-010 needs the rejection content of 004.
- Once shipped, the help is part of the interface contract: changing it needs the same care as other interface changes, and changed command-line behavior needs contract checks for streams, exit status and applicable error cases (Constitution III). Documentation ships in the same change.
- Source: the owner's decision during the developer-experience review of 2026-11-09 to make self-describing help the main onboarding aid, and feedback items 28.10/1 (revision values are learned one at a time) and 28.10/8c (three revision values for one completion). The review is kept by the owner outside the repository.
