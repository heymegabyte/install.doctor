## ADDED Requirements

### Requirement: Strict offline release test fixtures

The control-plane offline request and publication storage tests and the Desktop Tools release fixture SHALL pass the shared strict typed lint profile.

#### Scenario: Offline release fixtures exercise existing contracts

- **WHEN** the focused offline release test suites run
- **THEN** their signing authority, private storage, and release verification assertions execute against local fixtures
