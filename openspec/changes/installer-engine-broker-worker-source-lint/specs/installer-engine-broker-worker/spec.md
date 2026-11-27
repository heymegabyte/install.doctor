# Installer Engine broker worker

## ADDED Requirements

### Requirement: Broker worker source passes strict typed lint

The broker worker SHALL pass the standard Installer Engine strict source lint gate.

#### Scenario: Validate a worker invocation

- **WHEN** the worker receives or resolves privileged execution inputs
- **THEN** input bounds, authority bindings, and receipt handling follow the established contracts.
