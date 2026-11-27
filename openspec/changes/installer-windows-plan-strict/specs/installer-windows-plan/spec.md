## ADDED Requirements

### Requirement: Strict Windows fixture operation planning

The Windows operation planner and fixture evaluator SHALL pass the standard strict source lint gate.

#### Scenario: Fixture mutates state

- **WHEN** a fixture writes file contents, sets a registry value, or materializes a secret
- **THEN** the fixture records the validated immutable digest and retains its idempotent outcome.
