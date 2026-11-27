## ADDED Requirements

### Requirement: Strict policy-rc.d transaction

The native policy-rc.d transaction module SHALL pass the normal strict source gate.

#### Scenario: Durable callbacks are missing

- **WHEN** a JavaScript caller omits durable persistence callbacks
- **THEN** the operation rejects the request before reading or mutating transaction state.
