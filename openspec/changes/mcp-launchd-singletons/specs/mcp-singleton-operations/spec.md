# MCP singleton operations

## ADDED Requirements

### Requirement: Private singleton backends

Eligible wrappers SHALL run once per logged-in user behind private Unix sockets and SHALL NOT create wildcard or LAN listeners.

#### Scenario: Concurrent clients reuse an identifier

- **WHEN** two clients send requests with the same JSON-RPC identifier
- **THEN** each receives only its own response with its original identifier

### Requirement: Secret-free lifecycle

Launch definitions and generated configuration SHALL contain no credential values and SHALL use user-private file modes.

#### Scenario: Rollback

- **WHEN** the singleton rollout is rolled back
- **THEN** only the singleton launch agent and sockets are removed while CUA Driver, BrowserMCP, and unrelated client entries remain untouched

