## ADDED Requirements

### Requirement: Strict bundled HTTP fixture

The bundled HTTP suite SHALL pass the shared strict typed lint profile.

#### Scenario: Existing fixture tests run

- **WHEN** the bundled suite uses D1, Web Crypto and mock object storage
- **THEN** their existing fixture behavior and assertions remain active
