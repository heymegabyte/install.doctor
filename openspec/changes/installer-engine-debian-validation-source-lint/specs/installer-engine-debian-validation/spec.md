# Installer Engine Debian validation

## ADDED Requirements

### Requirement: Debian validation source passes strict typed lint

The Debian metadata, relationship, and native composition modules SHALL pass the standard Installer Engine strict source lint gate.

#### Scenario: Validate Debian evidence and compose package intent

- **WHEN** Installer Engine verifies repository evidence, resolves a dependency closure, or composes the native Debian package slice
- **THEN** accepted inputs, checksum and authority checks, and dependency order follow the established contracts.
