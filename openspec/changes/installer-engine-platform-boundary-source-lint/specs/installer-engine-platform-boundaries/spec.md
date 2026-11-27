# Installer Engine platform boundaries

## ADDED Requirements

### Requirement: Platform boundary modules pass strict typed lint

The Proxmox lifecycle, Qubes native lifecycle, and WSL boundary modules SHALL pass the shared strict typed lint profile while preserving their existing decisions and evidence contracts.

#### Scenario: Evaluate platform lifecycle state

- **WHEN** Installer Engine evaluates disposable platform fixture state or verifies WSL continuation evidence
- **THEN** admission, offline checks, and continuation digests follow their established contracts.
