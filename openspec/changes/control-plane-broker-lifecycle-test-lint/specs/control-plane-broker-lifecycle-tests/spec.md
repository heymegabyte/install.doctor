## ADDED Requirements

### Requirement: Strict typed broker and credential lifecycle fixtures

The broker run-intent and credential lifecycle rebuild fixtures SHALL pass the shared strict typed lint profile while retaining existing authority and lifecycle assertions.

#### Scenario: Local broker and credential fixtures verify successfully

- **WHEN** both focused test suites run
- **THEN** broker authority checks, credential state transitions, and failure cases are verified without external operations
