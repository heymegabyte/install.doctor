# Installer Engine broker controller

## ADDED Requirements

### Requirement: Broker controller passes strict typed lint

The broker controller SHALL pass the standard Installer Engine strict source lint gate.

#### Scenario: Validate and run a broker controller session

- **WHEN** the controller validates approval and runs its bounded helper
- **THEN** delegation checks, process lifecycle, and cleanup follow the established contracts.
