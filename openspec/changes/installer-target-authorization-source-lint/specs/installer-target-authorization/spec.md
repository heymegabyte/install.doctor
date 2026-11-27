## ADDED Requirements

### Requirement: Strict target device authorization source

The target device authorization, its HTTP transport, and its protected credential store SHALL pass the ordinary strict Installer Engine source gate.

#### Scenario: Device polls for enrollment approval

- **WHEN** a target applies an authorization response
- **THEN** the device binding and poll fingerprint are verified and approved authority is persisted with the existing restrictions.
