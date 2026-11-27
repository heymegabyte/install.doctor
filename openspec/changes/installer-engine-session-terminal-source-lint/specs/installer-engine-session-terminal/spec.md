# Installer Engine session and terminal

## ADDED Requirements

### Requirement: Session journal and terminal controller source pass strict typed lint

Both Installer Engine modules SHALL pass the shared strict typed lint profile and preserve their session journal and terminal input contracts.

#### Scenario: Process session events and terminal input

- **WHEN** the session journal validates ordered evidence or the terminal controller processes interactive input
- **THEN** event format, ordering, terminal outcome validation, and Unicode filter behavior follow the existing contracts.
