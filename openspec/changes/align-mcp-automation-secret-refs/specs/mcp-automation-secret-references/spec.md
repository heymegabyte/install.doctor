## ADDED Requirements

### Requirement: Automation secret references match the pinned host manifest

The portal helper SHALL request exactly the client ID and client secret names
declared by the pinned canonical automation manifest and SHALL defer their
resolution until child-process execution.

#### Scenario: canonical references are available

- **GIVEN** a supported host project contains the canonical automation pair
- **WHEN** the automation helper starts a child process
- **THEN** it resolves those exact names through the approved broker
- **AND** exposes only the two mapped header variables to the child
- **AND** writes or prints neither value

#### Scenario: descriptor drifts from the canonical manifest

- **GIVEN** the standalone compatibility descriptor names a different key
- **WHEN** repository verification runs
- **THEN** verification fails before installation or execution
