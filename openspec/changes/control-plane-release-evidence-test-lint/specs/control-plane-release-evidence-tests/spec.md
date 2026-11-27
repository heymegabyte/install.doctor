## ADDED Requirements

### Requirement: Strict release evidence fixtures

The Control Plane release evidence fixtures SHALL pass the shared strict typed lint profile while continuing to exercise existing evidence verification behavior.

#### Scenario: Evidence checks run against typed byte streams

- **WHEN** the release evidence tests run
- **THEN** the tests verify signed-size limits, decoding, and digest behavior through local fixtures
