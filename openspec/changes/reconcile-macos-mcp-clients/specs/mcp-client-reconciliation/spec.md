## ADDED Requirements

### Requirement: Client-native caller-class reconciliation

The installer SHALL reconcile pinned MCP host profiles into each supported client's native configuration while selecting exactly one appropriate caller class and preserving unrelated entries.

#### Scenario: Plan a human macOS client

- **WHEN** an operator plans reconciliation for Codex, Claude, OpenCode, or Cursor on macOS
- **THEN** the desired configuration contains `megabyte-primary` from `macos-human`
- **AND** it does not contain `megabyte-automation`
- **AND** every unrelated local or remote entry is preserved

#### Scenario: Encounter an unsupported or colliding configuration

- **WHEN** the native document cannot be parsed losslessly or a foreign entry owns a canonical managed name
- **THEN** planning fails before any file is written

### Requirement: Reversible multi-client apply

The installer SHALL apply an approved multi-client plan atomically and SHALL retain mode-safe predecessors and a metadata-only receipt sufficient for drift-safe rollback.

#### Scenario: Verification fails after a write

- **WHEN** any client-native verification fails during apply
- **THEN** every written client file is restored to its verified predecessor
- **AND** no credential value appears in output or receipts
