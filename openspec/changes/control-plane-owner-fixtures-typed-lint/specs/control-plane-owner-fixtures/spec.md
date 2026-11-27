## ADDED Requirements

### Requirement: Owner authorization fixtures pass strict typed lint

The owner approval, privileged pair binding, and target authorization owner fixtures SHALL pass the shared strict typed lint profile and preserve their authorization and denial assertions.

#### Scenario: Validate all three fixtures

- **WHEN** the three fixtures are checked against the Control Plane test TypeScript project and executed with the existing Node test runner
- **THEN** lint, type checking, and the existing test assertions pass
