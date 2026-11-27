# MCP host manifest consumption

## ADDED Requirements

### Requirement: Canonical pin verification

The consumer SHALL accept only artifacts whose bytes match the configured SHA-256 pin and whose embedded source digest and selector match the pinned assignment.

#### Scenario: Tampered artifact

- **WHEN** an acquired profile differs from its pinned digest
- **THEN** planning fails before any destination or rollback artifact is written

### Requirement: Host-specific selection

The consumer SHALL select exactly `macos-human` plus `macos-automation` for macOS workstations and `ubuntu-human` plus `ubuntu-automation` for Ubuntu runners. Automation runtime credentials SHALL remain value-free references.

#### Scenario: Ubuntu automation selection

- **WHEN** an operator plans installation for `ubuntu-runner`
- **THEN** the Ubuntu human and automation manifests are selected and their runtime references remain unresolved

### Requirement: Preserving merge

The consumer SHALL preserve unrelated descriptor fields and MCP client registrations. It SHALL reject an existing managed name whose content differs from the canonical entry.

#### Scenario: Foreign managed-name collision

- **WHEN** an existing client owns `megabyte-primary` without canonical ownership metadata
- **THEN** installation fails before modifying the client while unrelated entries remain unchanged

### Requirement: Atomic apply and rollback

Apply SHALL require an explicit flag, snapshot predecessors with restrictive permissions, use same-directory atomic replacement, and emit a metadata-only receipt. Rollback SHALL reject installed-content drift before restoring or removing the exact installed outputs.

#### Scenario: Drift after installation

- **WHEN** an operator changes an installed output after apply
- **THEN** rollback refuses to overwrite that change
