# OnePrompt convergence supervisor requirements

## ADDED Requirements

### Requirement: one authoritative service

The host provisioner SHALL use exactly one stable service identity per user and SHALL NOT start another writer during installation.

#### Scenario: repeated installation

- **WHEN** the same validated repository and controller are installed twice
- **THEN** the rendered service definition is unchanged and no service is started

### Requirement: durable operator intent

Pause and stop intent SHALL be persisted outside the repository before the service is stopped, and automatic supervisor behavior SHALL NOT override that intent.

#### Scenario: stopped service is queried

- **WHEN** stop intent exists and the process is not running
- **THEN** machine-readable status reports `desiredMode: stopped` and does not report a healthy worker

### Requirement: independent health evidence

Status SHALL distinguish supervisor liveness, worker liveness, and heartbeat freshness. Log output alone SHALL NOT establish health.

#### Scenario: stale heartbeat with active service

- **WHEN** the service manager reports active but the heartbeat exceeds its freshness bound
- **THEN** status reports a stale/unhealthy worker

### Requirement: portable supported service managers

The utility SHALL generate a launchd user agent on macOS and a systemd user service on Linux without embedding secrets.

#### Scenario: unsupported host

- **WHEN** neither supported manager is available
- **THEN** installation fails clearly without writing a partial service definition

### Requirement: synthetic lifecycle verification

Lifecycle tests SHALL use isolated temporary homes and fake service-manager commands and SHALL NOT stop, start, or crash production migration work.

#### Scenario: isolated lifecycle drill

- **WHEN** the supervisor lifecycle is verified
- **THEN** fake service-manager commands and temporary state are used and the live migration service remains untouched
