## ADDED Requirements

### Requirement: Check new Control Plane fixtures by default

The test lint command SHALL check fixtures under test unless an explicitly recorded existing file is excluded.

#### Scenario: A new fixture contains an ignored promise

- **WHEN** the test lint command runs with a new fixture that ignores a promise
- **THEN** the command reports the issue and fails
