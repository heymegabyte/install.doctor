## ADDED Requirements

### Requirement: Control Plane uses the canonical Node compiler profile

Control Plane's Node tooling project SHALL extend the exact Node profile from the qualified Theme Tools Testing archive and retain its existing JavaScript checking and source coverage.

#### Scenario: Existing Node tooling check with the shared profile

- **WHEN** CI checks Control Plane tooling with a locked installation
- **THEN** its effective compiler configuration and included files match the previous project and the normal typecheck passes
