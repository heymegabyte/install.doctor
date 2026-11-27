## ADDED Requirements

### Requirement: Strict offline bundle verification

The offline bundle module SHALL pass the normal Installer Engine strict source gate.

#### Scenario: Verification cannot find a required artifact

- **WHEN** bundle publication lacks required artifact bytes
- **THEN** verification rejects the bundle before publication.
