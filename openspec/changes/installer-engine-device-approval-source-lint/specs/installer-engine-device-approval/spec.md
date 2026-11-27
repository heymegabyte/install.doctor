# Installer Engine device approval

## ADDED Requirements

### Requirement: Device approval passes strict typed lint

The device approval module SHALL pass the standard Installer Engine strict source lint gate.

#### Scenario: Validate approval before grant publication

- **WHEN** the broker store checks a candidate approval
- **THEN** digest comparison and promise rejection follow the existing contracts.
