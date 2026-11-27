# Installer Engine broker transaction storage

## ADDED Requirements

### Requirement: Broker transaction storage passes strict typed lint

The broker transaction store SHALL pass the standard Installer Engine strict source lint gate.

#### Scenario: Read durable transaction evidence

- **WHEN** Installer Engine reads or saves broker transaction generations
- **THEN** protected file checks, transaction cardinality, and evidence digest handling follow the established contracts.
