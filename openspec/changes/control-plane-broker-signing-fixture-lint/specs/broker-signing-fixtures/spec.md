## ADDED Requirements

### Requirement: Broker signing fixtures pass strict typed lint

The managed signer, approval signer, and immutable release delegation loader fixtures SHALL pass the shared strict typed lint profile while retaining signing and rejection assertions.

#### Scenario: Verify the signing fixtures

- **WHEN** the fixtures are linted and executed with the Control Plane test project
- **THEN** the lint and runtime checks pass with their original authority and rejection assertions
