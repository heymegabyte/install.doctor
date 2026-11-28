## ADDED Requirements

### Requirement: Explicit recovery of an orphaned canonical definition

The adapter SHALL require an explicit absent predecessor path and a qualified destination before changing a recognized inactive orphaned OnePrompt launchd definition.

#### Scenario: Replace an orphaned checkout while preserving stop

- **GIVEN** the canonical predecessor has an absent checkout and matches the expected OnePrompt program, state and environment
- **WHEN** an operator adopts it to a validated pinned checkout
- **THEN** the adapter preserves the prior definition, installs the destination inactive, and preserves stopped intent

#### Scenario: Reject an unrelated definition

- **GIVEN** an absent predecessor was supplied but the definition points elsewhere or has an unrecognized environment
- **WHEN** the operator attempts adoption
- **THEN** the adapter denies it before any manager or file mutation
