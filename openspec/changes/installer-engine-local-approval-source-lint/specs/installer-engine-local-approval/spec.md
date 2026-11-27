# Installer Engine local broker approval

## ADDED Requirements

### Requirement: Local broker approval passes strict typed lint

The local broker approval module SHALL pass the standard Installer Engine strict source lint gate.

#### Scenario: Verify trusted local approval

- **WHEN** Installer Engine evaluates a trusted local approval
- **THEN** the terminal confirmation and promise-based evidence validation follow their established contracts.
