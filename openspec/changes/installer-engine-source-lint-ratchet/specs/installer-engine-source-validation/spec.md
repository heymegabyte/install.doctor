# Installer Engine source validation

## ADDED Requirements

### Requirement: Installer Engine enforces its strict source lint baseline

Installer Engine tests and Linux structural verification SHALL apply the shared strict typed ESLint profile to all source modules except the measured exact paths with unresolved findings.

#### Scenario: Reject lint errors in a new Installer Engine source file

- **WHEN** a new TypeScript file under Installer Engine source violates a strict lint rule
- **THEN** the normal source lint command reports the finding without any configuration change.
