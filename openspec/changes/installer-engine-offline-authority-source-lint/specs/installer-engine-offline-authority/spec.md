# Installer Engine offline authority

## ADDED Requirements

### Requirement: Offline authority source passes strict typed lint

Offline authority validation SHALL pass the standard Installer Engine strict source lint gate.

#### Scenario: Verify a signing request or independent promotion evidence

- **WHEN** Installer Engine parses offline authority inputs
- **THEN** collection ordering, canonical digest inputs, and CI authority bindings follow the established contracts.
