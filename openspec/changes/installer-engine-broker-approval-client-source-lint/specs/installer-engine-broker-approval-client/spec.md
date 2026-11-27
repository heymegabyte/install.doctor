# Installer Engine broker approval clients

## ADDED Requirements

### Requirement: Broker approval client modules pass strict typed lint

The broker approval orchestrator and transport SHALL pass the standard Installer Engine strict source lint gate.

#### Scenario: Request and poll for broker approval

- **WHEN** Installer Engine requests or polls for broker approval
- **THEN** polling bounds, request validation, response size limits, and diagnostics follow the existing contracts.
