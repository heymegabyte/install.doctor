## ADDED Requirements

### Requirement: Complete Control Plane test fixture lint coverage
The Control Plane test lint command SHALL check every tracked JavaScript test and helper under the Control Plane test directory with the shared strict typed configuration.

#### Scenario: Enumerate the enforced lint scope
- **WHEN** the normal fixture lint gate runs
- **THEN** its checked file set includes all tracked Control Plane JavaScript test and helper files
- **AND** no fixture migration exceptions are configured
