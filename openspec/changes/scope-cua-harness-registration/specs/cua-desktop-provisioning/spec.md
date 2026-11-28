## ADDED Requirements

### Requirement: Desktop setup preserves agent configuration

The Cua desktop post-install hook SHALL preserve existing agent configuration and SHALL NOT register the desktop driver or its skills with any agent harness.

#### Scenario: Selected driver is already installed

- **WHEN** the Cua desktop hook runs on an applicable host with a verified driver installed
- **THEN** the native driver remains available and the hook leaves all agent configuration and skill entries untouched

#### Scenario: Headless provisioning

- **WHEN** the Cua hook is selected in a headless installation
- **THEN** the hook skips desktop activation and agent configuration
