## ADDED Requirements

### Requirement: Strict Debian observation modules

The native Debian package state and archive observation modules SHALL pass the normal strict Installer Engine source lint gate.

#### Scenario: Invalid observation input

- **WHEN** a read-only observation returns malformed metadata or exceeds the output bound
- **THEN** the observer rejects that input through its existing diagnostic path.
