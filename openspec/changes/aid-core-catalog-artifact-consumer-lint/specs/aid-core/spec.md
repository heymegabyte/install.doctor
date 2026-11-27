# Aid Core catalog artifact consumer checks

## ADDED Requirements

### Requirement: Aid Core checks the catalog artifact validator

The normal Aid Core package checks SHALL type-check and strictly lint the standalone catalog artifact validator using the built immutable artifact descriptor declaration.

#### Scenario: Verify the catalog contract consumer

- **WHEN** the normal Aid Core package test runs
- **THEN** the TypeScript and strict ESLint checks cover the standalone catalog artifact validator.
