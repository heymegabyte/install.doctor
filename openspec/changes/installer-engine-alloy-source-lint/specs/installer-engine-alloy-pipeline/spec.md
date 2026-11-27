# Installer Engine Alloy pipeline

## ADDED Requirements

### Requirement: Alloy pipeline source passes strict typed lint

The Alloy reconciler SHALL pass the standard Installer Engine strict source lint gate.

#### Scenario: Collect Alloy validation output

- **WHEN** Installer Engine runs the Alloy validation command
- **THEN** subprocess output, status, and last-valid publication follow the existing contracts.
