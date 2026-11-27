# MCP singleton operations

## ADDED Requirements

### Requirement: Canonical least-privilege admission

The system SHALL deploy only MCP identities marked singleton-eligible by a pinned canonical registry and explicitly allowed by the selected versioned host profile.

#### Scenario: Host profile attempts to broaden eligibility

- **WHEN** a host profile includes an unknown, stale, session-bound, or canonically ineligible MCP identity
- **THEN** rendering fails before service or client configuration is mutated

#### Scenario: Platform-specific host admission

- **WHEN** an enrolled macOS or Ubuntu host selects a valid profile
- **THEN** the effective singleton set is the exact intersection of canonical eligibility and that host profile

### Requirement: Private isolated singleton backends

Eligible wrappers SHALL run at most once per admitted user behind user-owned private Unix sockets and SHALL NOT create TCP, wildcard, LAN, tunnel, or public listeners.

#### Scenario: Concurrent clients reuse an identifier

- **WHEN** two clients send requests with the same JSON-RPC identifier
- **THEN** each receives only its own response and notifications with its original identifier

#### Scenario: Client disconnects with pending work

- **WHEN** a client disconnects or cancels pending work
- **THEN** ownership is removed or cancellation is propagated without delivering results to another client

### Requirement: Native per-user service management

The system SHALL use a per-user LaunchAgent in the macOS `gui/<uid>` domain and a systemd user service on Ubuntu, never a root LaunchDaemon or system service.

#### Scenario: Ubuntu service is installed

- **WHEN** an admitted Ubuntu profile is installed
- **THEN** the service uses `%t` private runtime state, mode-`0600` sockets, `UMask=0077`, bounded restart behavior, and `systemctl --user` lifecycle

#### Scenario: Headless host requests lingering

- **WHEN** operation without an interactive login requires systemd lingering
- **THEN** installation remains blocked until an explicit headless profile separately authorizes lingering and its rollback

### Requirement: Offline-safe local boundary

Broker configuration, local socket lifecycle, health, and rollback SHALL operate without network access, while remote-dependent wrappers SHALL fail within bounded time without expanding authority.

#### Scenario: Network and secret broker are unavailable

- **WHEN** the broker starts while remote upstreams and the online secret broker are unavailable
- **THEN** it reaches a typed local degraded state without hanging, persisting credentials, broadening the profile, or exposing shell/filesystem/GUI/session tools

#### Scenario: Local host-control MCP remains separate

- **WHEN** the singleton broker is installed, restarted, or rolled back
- **THEN** CUA Driver, BrowserMCP, filesystem, shell, and unrelated session MCP processes remain outside its lifecycle

### Requirement: Secret-free deterministic lifecycle

Generated service definitions, client shims, logs, health output, and receipts SHALL contain only approved secret references and SHALL NOT contain credential values, authorization headers, sensitive payloads, or tool results.

#### Scenario: Definition is rendered twice

- **WHEN** the same registry revision, host profile, platform facts, and artifacts are rendered twice
- **THEN** the definitions are byte-identical and reference only approved runtime secret names

### Requirement: Atomic migration and scoped rollback

Client migration SHALL occur only after platform lifecycle, protocol, isolation, offline, security, and rollback canaries pass, and rollback SHALL restore only the exact managed predecessor state.

#### Scenario: Rollback on macOS

- **WHEN** a macOS singleton rollout is rolled back
- **THEN** only its LaunchAgent, managed sockets, and migrated client entries are reverted through `gui/<uid>` while unrelated and session-bound tools remain untouched

#### Scenario: Rollback on Ubuntu

- **WHEN** an Ubuntu singleton rollout is rolled back
- **THEN** only its systemd user service, managed sockets, and migrated client entries are disabled/restored while other users, system units, and session-bound tools remain untouched
