## ADDED Requirements

### Requirement: Strict Installer Engine authorization contracts

The host ownership and reviewed provisioning authorization modules SHALL pass the ordinary strict source lint gate.

#### Scenario: Existing authorization evidence
- **WHEN** the Installer Engine loads a valid existing lease, reviewed plan, or provisioning context
- **THEN** its validation and canonical digest semantics remain compatible with the existing format.
