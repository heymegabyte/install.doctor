## ADDED Requirements

### Requirement: Track the active offline template filenames

The offline inventory SHALL describe the Git-tracked filenames in each
configured template store after credential template retirements.

#### Scenario: Validate inventory after template retirement

- **WHEN** the inventory checker reads a checkout with retired templates absent
- **THEN** the remaining template filenames match the recorded count and digest
