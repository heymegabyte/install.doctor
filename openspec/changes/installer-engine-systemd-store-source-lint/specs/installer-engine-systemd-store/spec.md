# Installer Engine systemd transaction storage

## ADDED Requirements

### Requirement: Systemd transaction storage passes strict typed lint

The systemd transaction store SHALL pass the standard Installer Engine strict source lint gate.

#### Scenario: Read durable systemd transaction evidence

- **WHEN** Installer Engine saves or reads a systemd transaction
- **THEN** ownership, cardinality, and evidence digest checks follow their established contracts.
