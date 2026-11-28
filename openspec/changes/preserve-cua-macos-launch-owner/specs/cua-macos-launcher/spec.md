## ADDED Requirements

### Requirement: macOS autostart uses the signed Cua app identity

Install Doctor SHALL use the signed canonical Cua Driver app and preserve any active native daemon during provisioning.

#### Scenario: The existing Cua daemon already serves the current session

- **WHEN** the selected operator has a running Cua daemon with the default policy
- **THEN** provisioning stages the native launcher for a later login without restarting the current daemon

#### Scenario: Existing launch policy is customized

- **WHEN** a custom legacy launcher, nondefault daemon policy, or explicit disabled state exists
- **THEN** provisioning preserves that policy and reports the condition
