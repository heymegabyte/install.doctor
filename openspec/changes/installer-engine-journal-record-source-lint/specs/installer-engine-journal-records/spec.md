# Installer Engine journal records

## ADDED Requirements

### Requirement: Journal and native record sources pass strict typed lint

The run journal and native dpkg and systemd record persistence modules SHALL pass the shared strict typed lint profile while preserving persisted contracts and integrity checks.

#### Scenario: Read or validate a persisted run

- **WHEN** Installer Engine resumes a run or reads its compensation and transaction evidence
- **THEN** normalized plan comparison, artifact validation, and absent record handling follow their established behavior.
