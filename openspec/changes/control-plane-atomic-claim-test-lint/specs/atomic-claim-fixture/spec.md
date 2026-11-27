## ADDED Requirements

### Requirement: Strict lint for atomic claim fixtures
The Control Plane fixture gate SHALL apply strict typed lint to the atomic credential claim fixture.

#### Scenario: Validate the in-memory claim and revoke store
- **WHEN** the Control Plane fixture lint command runs
- **THEN** the atomic credential claim test file is checked by the strict typed profile
