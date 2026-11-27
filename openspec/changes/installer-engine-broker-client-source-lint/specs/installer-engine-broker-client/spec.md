# Installer Engine broker client

## ADDED Requirements

### Requirement: Broker client source passes strict typed lint

The broker client SHALL pass the standard Installer Engine strict source lint gate.

#### Scenario: Send a broker request

- **WHEN** Installer Engine prepares a privileged broker request or checks its response
- **THEN** file access, output bounds, and request and receipt bindings follow the established contracts.
