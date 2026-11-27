## ADDED Requirements

### Requirement: Preserve signed fixture inputs

Bootstrap test fixtures SHALL construct textual manifest fields with explicit conversions.

#### Scenario: A fixture release is exercised

- **WHEN** the bootstrap fixture constructs and signs a release
- **THEN** the existing release and platform assertions continue to run against the same fields
