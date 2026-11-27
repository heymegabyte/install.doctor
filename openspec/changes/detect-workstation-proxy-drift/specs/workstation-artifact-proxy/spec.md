## ADDED Requirements

### Requirement: A healthy workstation proxy has verifiable deployment identity

Workstation diagnostics SHALL distinguish the selected proxy artifact, installed bytes, and running service identity. Proxy HTTP health alone SHALL leave deployment identity unverified.

#### Scenario: Older source is installed behind a healthy listener

- **WHEN** the workstation proxy reports HTTP health and the installed or running identity differs from the selected artifact
- **THEN** the diagnostic reports the mismatch and the identity evidence available

#### Scenario: New source is installed while the prior instance keeps serving

- **WHEN** installed bytes match the target but the loaded service identity differs
- **THEN** the diagnostic reports that a restart is needed

### Requirement: Local proxy reconciliation preserves a verified rollback

Workstation proxy reconciliation SHALL stage and verify the selected artifact and retain the previous installed artifact before changing the service. A completed reconciliation or rollback SHALL verify the local socket, process, artifact identity, and package smoke evidence.

#### Scenario: A local qualification is using the listener

- **WHEN** an operator plans to restart the workstation proxy while a package qualification uses it
- **THEN** reconciliation preserves that run by coordinating the restart or isolating its package traffic first

#### Scenario: The candidate cannot be verified after restart

- **WHEN** the candidate fails the post-restart health or identity checks
- **THEN** the rollback path restores the retained bytes and verifies the restarted prior service
