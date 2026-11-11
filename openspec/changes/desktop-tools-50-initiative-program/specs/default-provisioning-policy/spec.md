# Spec Delta

## MODIFIED Requirements

### Requirement: Automatic provisioning honors default eligibility
The system SHALL exclude every catalog entry marked as not default-eligible and SHALL admit remaining entries only when their dependency closure, host capability, platform evidence, role, architecture, load policy, privilege, network exposure, consent, and recipe verification satisfy the selected policy.

#### Scenario: Default graphical workstation provisioning
- **WHEN** provisioning requests all lazy-eligible packages
- **THEN** entries marked as not default-eligible or failing an admission condition are not included in installation instructions

#### Scenario: Default headless provisioning
- **WHEN** provisioning requests all lazy-eligible packages on a headless host
- **THEN** entries marked as not default-eligible are not included even if they define an enabled service or preload

#### Scenario: Dependency is unsupported
- **WHEN** an otherwise eligible entry depends on a package without an admitted recipe for the target support cell
- **THEN** the entry is excluded with an exact closure explanation rather than partially installed

### Requirement: Explicit package requests remain available
The system SHALL allow a not-default-eligible entry to be requested by exact catalog key, but SHALL still enforce platform, capability, dependency, provenance, privilege, consent, conflict, revocation, and support-cell policy before mutation.

#### Scenario: Explicit specialist installation
- **WHEN** a user invokes the installer with the exact key of a not-default-eligible entry without automatic all-package selection
- **THEN** the entry proceeds through the normal admission and approval policy instead of automatic exclusion

#### Scenario: Explicit request cannot broaden authority
- **WHEN** an exact package request requires unapproved privilege, network exposure, or secret access
- **THEN** planning reports the missing authority and execution remains denied

### Requirement: Exclusion policy is regression protected
The system SHALL maintain machine-readable exclusion, replacement, migration, and rationale evidence for approved removal candidates and SHALL verify that automatic selection, explicit compatibility, and live-host preservation follow that policy.

#### Scenario: Policy validation
- **WHEN** provisioning hygiene tests run
- **THEN** all approved keys and replacements have coherent lifecycle metadata and selectors enforce the declared behavior
