# Installer Engine lifecycle policy

## ADDED Requirements

### Requirement: Lifecycle policy modules pass strict typed lint

Deprovision planning, effect migration, and mobile reconciliation policy SHALL pass the shared strict typed lint profile while preserving their validation and decisions.

#### Scenario: Evaluate a lifecycle plan

- **WHEN** Installer Engine prepares deprovision or mobile reconciliation plans or checks an effect migration manifest
- **THEN** datetime validation, effect classification, and power and scheduling decisions follow their established contracts.
