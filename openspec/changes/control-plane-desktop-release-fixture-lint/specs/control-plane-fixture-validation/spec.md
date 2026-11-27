# Control Plane fixture validation

## ADDED Requirements

### Requirement: Desktop Tools release tests satisfy the shared strict lint profile

The Control Plane Desktop Tools release builder, channel, and publication suites SHALL pass the repository's shared strict typed lint profile and retain their existing runtime assertions.

#### Scenario: Validate signed release fixtures locally

- **WHEN** a contributor runs strict lint and the focused Desktop Tools release suites
- **THEN** the three suites produce zero lint findings and their runtime checks execute using disposable release files and in-memory storage.
