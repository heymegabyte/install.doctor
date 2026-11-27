## ADDED Requirements

### Requirement: Strictly check configuration and service transactions

Configuration transaction and service adapter sources SHALL pass the normal strict lint gate.

#### Scenario: Restore a service snapshot

- **WHEN** a configuration rollback includes a validated service snapshot
- **THEN** restoration uses the existing adapter and exact service identity
