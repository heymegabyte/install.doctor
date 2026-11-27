# Aid Core status generator consumer checks

## ADDED Requirements

### Requirement: Desktop Tools status generation is checked by Aid Core

The normal Aid Core package checks SHALL type-check and strictly lint the Desktop Tools status generator.

#### Scenario: Verify the product identity consumer

- **WHEN** the normal Aid Core package test runs
- **THEN** the status generator is checked against the built product identity declaration.
