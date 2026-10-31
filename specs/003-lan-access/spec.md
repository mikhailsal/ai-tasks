# Feature Specification: Opt-in local network access

**Feature**: `003-lan-access`
**Created**: 2026-10-31
**Status**: Implemented; awaiting human acceptance

**Input**: User description: "Add a supported way to open the web interface from other devices on the trusted home network (for example, a phone). Today it only works on the host computer; local network access has been assembled by hand each time and disappears after a restart. No access token or password for now."

## User Scenarios & Testing

### User Story 1 - Open the application from a phone on the home network (Priority: P1)

The owner starts the application in an explicit local network mode on the host computer. The application reports the address to open. On a phone or another computer connected to the same network, the owner opens that address and works with projects and tasks exactly as on the host.

**Why this priority**: This is the whole purpose of the feature. Today the owner has to set up access manually every time.

**Independent Test**: Start in local network mode, open the reported address from a second device on the same network, view a project board and save a task change; confirm the change and its history entry appear on the host.

**Acceptance Scenarios**:

1. **Given** the application is started in local network mode with a chosen network address, **When** it becomes ready, **Then** it states the exact address to open from other devices.
2. **Given** local network mode is running, **When** a device on the same network opens the stated address, **Then** the interface loads and reads, changes, offline caching and history behave as when opened on the host computer.
3. **Given** local network mode is running, **When** a change is saved from another device, **Then** it is attributed to the human interface in history, as any other browser change.
4. **Given** local network mode is running, **When** the application is opened on the host computer through the stated network address, **Then** it works as from any other device.

---

### User Story 2 - Private by default (Priority: P1)

Starting the application normally keeps it reachable only from the host computer, as today. Network access exists only when the owner explicitly asks for it, and the owner is told that anyone on the network can then read and change data.

**Why this priority**: The application has no login. Silently exposing it would let any device on the network change tasks.

**Independent Test**: Start normally and confirm that another device cannot connect; start in local network mode and confirm the startup message contains the access warning.

**Acceptance Scenarios**:

1. **Given** the owner starts the application without choosing local network mode, **When** another device tries to connect, **Then** the connection is not possible, exactly as before this feature.
2. **Given** the owner starts the application in local network mode, **When** it becomes ready, **Then** a visible warning states that every device on that network can read and change all data without signing in.
3. **Given** an existing installation and its usual start procedure, **When** the owner upgrades, **Then** behavior and the address to open are unchanged until local network mode is chosen.

---

### User Story 3 - Clear failures instead of a broken page (Priority: P2)

If local network mode is configured incorrectly, the application refuses to start with an understandable explanation, rather than starting and then rejecting every page or change.

**Why this priority**: A half-working start is what made manual setup confusing. An immediate, explained failure is cheaper to fix.

**Independent Test**: Start local network mode with an address the computer does not have, and separately with a mismatched browser address; each attempt stops with a message naming the problem and nothing listens on the network.

**Acceptance Scenarios**:

1. **Given** local network mode is requested with an address that does not belong to this computer, **When** starting, **Then** startup fails with an explanation and the application does not run.
2. **Given** local network mode is requested together with a browser address that does not match the network address and port, **When** starting, **Then** startup fails with an explanation.
3. **Given** local network mode is requested for a wildcard "all networks" address, **When** starting, **Then** startup fails and explains that a specific network address must be chosen.
4. **Given** the chosen port is already in use, **When** starting, **Then** startup fails with an explanation, as it does today.

---

### User Story 4 - Requests from other websites are still refused (Priority: P2)

Opening the application on the network must not weaken the existing protection against other websites changing tasks through the owner's browser.

**Why this priority**: Network mode adds new addresses; existing browser protections must apply to them unchanged.

**Independent Test**: In local network mode, send a change that claims to come from an unrelated website or uses an unexpected address, and confirm it is rejected without changing data or history.

**Acceptance Scenarios**:

1. **Given** local network mode is running, **When** a page from an unrelated website attempts a change, **Then** the change is rejected and no data or history changes.
2. **Given** local network mode is running, **When** a request uses an address other than the stated one (for example, the loopback address or a different name for the same computer), **Then** it is rejected as today, and the stated address is the one to use.

### Edge Cases

- The host computer has several network addresses (wired, wireless, virtual adapters, VPN). The owner chooses one explicitly; the application never picks a network by itself.
- The host's network address changes after startup (for example, a new lease from the router). The stated address stops working; the owner restarts with the new address. Automatic re-detection is not provided.
- The assistant command interface is unaffected by local network mode and keeps working on the host computer.
- A device opens the interface over the network without a secure connection. All existing features, including creating changes and offline reading, still work there.
- Background recurring work, backup and restore behave identically in both modes.
- The phone switches to mobile data. The application is unreachable; already loaded data remains readable offline as today.

## Requirements

### Functional Requirements

- **FR-001 — Explicit opt-in**: The application MUST remain reachable only from the host computer unless the owner explicitly chooses local network mode for that start.
- **FR-002 — Chosen network address**: In local network mode, the owner MUST choose one specific network address of the host computer. The application MUST NOT choose a network itself or listen on all networks at once.
- **FR-003 — One documented start command**: The project MUST provide one documented way to start local network mode, with the network address and port as its only required choices.
- **FR-004 — Reported address**: When ready in local network mode, the application MUST state the exact address other devices should open.
- **FR-005 — Exposure warning**: When ready in local network mode, the application MUST warn that every device on that network can read and change all data without signing in.
- **FR-006 — Startup validation**: Startup MUST fail with an explanatory message, before accepting any request, when the chosen address is a wildcard, does not belong to this computer, or does not match the configured browser address and port.
- **FR-007 — Full functionality**: Every capability available on the host computer, including writes, offline reading, drafts, history and restore flows, MUST work from other devices opening the stated address, including over a connection without encryption.
- **FR-008 — Unchanged protections**: Existing protections against changes initiated by unrelated websites and against unexpected request addresses MUST apply unchanged in local network mode.
- **FR-009 — Unchanged default**: Existing start procedures, settings and the default address MUST behave exactly as before.
- **FR-010 — Documentation**: Operating documentation MUST describe how to start local network mode, how to find and choose the host's address, how to stop it, and the security consequences of running without accounts on a shared network.

### Key Entities

- **Network address choice**: The host computer address and port on which the application is offered to other devices, and the browser address that devices use to open it. Exists only for the duration of one start; nothing is stored in the task database.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Starting from a stopped application, the owner can open and use the interface from a phone on the same network using one documented command and the reported address, with no additional tools or manual forwarding.
- **SC-002**: With a normal start, 0 connection attempts from another device succeed.
- **SC-003**: Every invalid local network configuration listed in FR-006 stops startup with a message naming the problem; in 0 of those cases does the application accept requests.
- **SC-004**: A task change made from a second device appears on the host computer with a normal history entry, and a change attempted by an unrelated website is rejected in 100% of the covered cases.
- **SC-005**: Existing acceptance results for the default mode remain unchanged.

## Assumptions

- The network is a trusted private home network controlled by the owner. Sign-in, access tokens and passwords are explicitly out of scope for this feature and may be a later feature.
- Encrypted connections, certificates, public internet exposure, port forwarding and automatic device discovery are out of scope.
- Device firewalls and router configuration are the owner's responsibility; documentation may mention them but the application does not change them.
- Running as an always-on system service after reboot is out of scope; the owner starts the application when needed.
- The browser address used by devices is the host's network address and port; access through a custom host name is out of scope.
