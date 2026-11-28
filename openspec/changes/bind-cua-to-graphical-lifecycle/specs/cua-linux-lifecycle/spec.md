## ADDED Requirements

### Requirement: The Linux user launcher follows the graphical lifecycle

Install Doctor SHALL launch its managed Cua Driver unit only with the graphical user session and SHALL use the actual user manager environment rather than hardcoded display numbers.

#### Scenario: A lingering user manager starts without a desktop

- **WHEN** the default user target starts without a graphical session
- **THEN** the installed Cua unit is not enabled under that target

#### Scenario: A known legacy launcher is already active

- **WHEN** the managed legacy unit is migrated while the active desktop owns Cua Driver
- **THEN** the existing process remains active and the new graphical target relationship applies on future lifecycle transitions
