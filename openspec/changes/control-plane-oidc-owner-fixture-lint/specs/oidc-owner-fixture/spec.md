## ADDED Requirements

### Requirement: OIDC owner-enrollment fixture passes strict typed lint

The OIDC owner-enrollment fixture SHALL pass shared strict typed lint and preserve its assertions for callback session identity, owner review, credential claim, and replay denial.

#### Scenario: Verify owner enrollment through the callback session

- **WHEN** the fixture is linted against the Control Plane test project and run on the pinned Node runtime
- **THEN** strict lint and the existing owner enrollment assertions pass
