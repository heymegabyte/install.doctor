# Installer Engine platform fixtures

## ADDED Requirements

### Requirement: Platform fixture contracts pass strict typed lint

The Proxmox, Qubes, and Windows fixture contracts SHALL pass the shared strict typed lint profile while preserving validation and fixture evidence decisions.

#### Scenario: Validate fixture evidence

- **WHEN** Installer Engine parses a platform fixture or evaluates fixture evidence
- **THEN** accepted timestamps, Qubes request validation, and evidence decisions follow their established contracts.
