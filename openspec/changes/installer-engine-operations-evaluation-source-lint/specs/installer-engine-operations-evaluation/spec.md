# Installer Engine operational evaluations

## ADDED Requirements

### Requirement: Operational evaluation modules pass strict typed lint

Device posture, fault qualification, and fleet capacity and cost evaluation SHALL pass the standard Installer Engine strict source lint gate.

#### Scenario: Evaluate operational evidence

- **WHEN** Installer Engine validates operational timestamps or serializes deterministic fault evidence
- **THEN** validation outcomes, canonical key order, and decision identities follow the established contracts.
