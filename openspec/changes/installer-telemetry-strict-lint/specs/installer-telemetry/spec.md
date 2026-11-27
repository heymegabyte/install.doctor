## ADDED Requirements

### Requirement: Strict type checking for telemetry delivery
The Installer Engine telemetry export and delivery modules SHALL pass the normal strict source gate.

#### Scenario: Export timed out telemetry
- **WHEN** a consented export exceeds its deadline
- **THEN** the existing cancellation and timed-out result still apply
