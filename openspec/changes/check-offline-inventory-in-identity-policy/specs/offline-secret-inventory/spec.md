## ADDED Requirements

### Requirement: Verify offline metadata in identity policy CI

Changes to offline template stores or the inventory checker SHALL trigger
identity policy CI and verify the tracked filenames against the inventory.

#### Scenario: Detect an offline template change

- **WHEN** a tracked offline filename changes without its inventory metadata
- **THEN** the focused policy workflow fails its inventory step
