## ADDED Requirements

### Requirement: Strict dpkg fence source

The native dpkg ownership fence and quiescence observer SHALL pass the standard strict Installer Engine source gate.

#### Scenario: Another process holds the fence

- **WHEN** the native dpkg fence encounters existing owner evidence
- **THEN** it uses the existing ownership, integrity, and lease rules to admit or reject acquisition.
