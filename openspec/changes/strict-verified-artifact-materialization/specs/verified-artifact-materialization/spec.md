## ADDED Requirements

### Requirement: Strict artifact materialization

The Installer Engine artifact materializer SHALL pass the normal strict source lint gate.

#### Scenario: Transport or cache returns an invalid candidate

- **WHEN** a candidate does not conform to signed authority
- **THEN** admission retains its existing bounded verification and rejection behavior.
