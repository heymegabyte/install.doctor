## ADDED Requirements

### Requirement: Broker authorization fixtures pass strict typed lint

The broker authorization API, composition, and service fixtures SHALL pass shared strict typed lint while preserving their response, authority, and rejection tests.

#### Scenario: Verify the authorization fixtures

- **WHEN** the three suites are linted using the existing Control Plane test project and run with Node's test runner
- **THEN** strict lint and the existing runtime assertions pass
