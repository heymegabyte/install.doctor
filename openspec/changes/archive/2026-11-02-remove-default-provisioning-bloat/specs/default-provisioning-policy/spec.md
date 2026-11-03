# Spec Delta

## Purpose

Defines safe automatic software selection while preserving explicit access to specialist catalog entries when a user or host role requests them.

## ADDED Requirements

### Requirement: Automatic provisioning honors default eligibility
The system SHALL exclude every catalog entry marked as not default-eligible when software is selected through an automatic all-packages provisioning run.

#### Scenario: Default graphical workstation provisioning
- **WHEN** provisioning requests all lazy-eligible packages
- **THEN** entries marked as not default-eligible are not included in installation instructions

#### Scenario: Default headless provisioning
- **WHEN** provisioning requests all lazy-eligible packages on a headless host
- **THEN** entries marked as not default-eligible are not included even if they define an enabled service or preload

### Requirement: Explicit package requests remain available
The system SHALL allow a not-default-eligible catalog entry to be selected when its exact catalog key is explicitly requested.

#### Scenario: Explicit specialist installation
- **WHEN** a user invokes the installer with the exact key of a not-default-eligible entry without automatic all-package selection
- **THEN** the entry proceeds through the normal platform, presence, condition, and deprecation filters

### Requirement: Exclusion policy is regression protected
The system SHALL maintain a machine-readable exclusion marker on all 30 approved removal candidates and SHALL verify the policy in the repository test suite.

#### Scenario: Policy validation
- **WHEN** provisioning hygiene tests run
- **THEN** all approved keys exist, carry the exclusion marker, and the automatic selector enforces that marker
