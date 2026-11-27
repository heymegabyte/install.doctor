## ADDED Requirements

### Requirement: Strict offline execution boundaries

The offline sandbox and orchestration modules SHALL pass the standard Installer Engine strict source gate.

#### Scenario: Required native authority is unavailable

- **WHEN** a signed plan needs native packages and a required verifier is missing
- **THEN** orchestration rejects the plan before execution.
