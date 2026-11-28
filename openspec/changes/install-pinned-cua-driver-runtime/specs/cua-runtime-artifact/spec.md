## ADDED Requirements

### Requirement: Fresh selected desktops receive the verified runtime

Install Doctor SHALL install a pinned official Cua Driver artifact when the selected and applicable desktop has no installed driver.

#### Scenario: A selected desktop lacks Cua Driver

- **WHEN** a supported desktop selects the recipe and the driver is absent
- **THEN** the recipe verifies the exact release before publishing the command, preserving the signed bundle on macOS

#### Scenario: A verified artifact is unavailable

- **WHEN** the download, digest, native signature or executable validation fails
- **THEN** the hook reports failure before activating the new driver or modifying any harness configuration
