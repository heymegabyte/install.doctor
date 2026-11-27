## ADDED Requirements

### Requirement: Explicit Node test registration

The test source SHALL explicitly discard promises returned by outer Node test registrations.

#### Scenario: Control Plane suites register tests

- **WHEN** the existing test runner loads the Control Plane suites
- **THEN** test registration uses the existing callbacks and scheduling, and the typed lint rule continues to report other ignored promises
