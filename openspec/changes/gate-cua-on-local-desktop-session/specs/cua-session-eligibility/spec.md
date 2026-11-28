## ADDED Requirements

### Requirement: Local desktop ownership is required before Cua setup

The selected Cua post-install hook SHALL verify the target user's active local graphical session before installing or configuring desktop control.

#### Scenario: Provisioning over SSH while a local desktop is active

- **WHEN** a selected user provisions over SSH and owns the active local graphical session
- **THEN** the same session is eligible as when provisioning from a local shell

#### Scenario: No eligible local session exists

- **WHEN** the configured role is headless or only a forwarded display, remote desktop, greeter, or other user's session is present
- **THEN** the recipe skips without altering driver state, and its explicit preflight reports inapplicability
