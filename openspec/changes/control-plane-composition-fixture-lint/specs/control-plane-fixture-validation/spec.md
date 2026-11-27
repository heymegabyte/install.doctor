# Control Plane fixture validation

## ADDED Requirements

### Requirement: Composition fixtures satisfy the strict typed lint profile

The Control Plane Debian native and disposable product composition fixtures SHALL pass the shared strict typed lint profile and retain their existing runtime assertions.

#### Scenario: Verify local composition boundaries

- **WHEN** a contributor runs strict lint and the two composition suites on Node 24.22.2
- **THEN** both suites produce zero lint findings and execute the existing runtime assertions with local fixtures.
