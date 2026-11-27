# Aid Core software catalog verifier checks

## ADDED Requirements

### Requirement: Aid Core checks the software catalog verifier

Aid Core's normal package checks SHALL type-check and strictly lint the standalone software catalog verifier against the built Aid Core schema declaration.

#### Scenario: Verify the software catalog consumer

- **WHEN** the normal Aid Core package test runs
- **THEN** the TypeScript and strict ESLint checks cover the standalone software catalog verifier.
