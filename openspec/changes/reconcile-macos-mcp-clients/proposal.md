# Reconcile macOS MCP clients with canonical host manifests

**Architect Role:** assigned

## Why

The pinned macOS host profiles now grant the verified Megabyte OS baseline, but the workstation's actual Codex, Claude, OpenCode, and Cursor configurations do not contain the canonical `megabyte-primary` entry. The current consumer only merges JSON `mcpServers` and always emits both human and automation profiles, so applying it directly would misroute human clients and cannot safely update Codex TOML or OpenCode JSONC.

## Outcome

Add client-aware, caller-class-aware planning and reversible installation. Human clients receive only `macos-human`; automation clients receive only `macos-automation`. Preserve every unrelated entry, reject managed-name collisions, snapshot predecessors, and verify each client's native configuration after apply.

## Acceptance

- Codex TOML, Claude JSON, Cursor JSON, and OpenCode JSONC adapters plan native entries without schema conversion.
- Human-client plans contain `megabyte-primary` only; automation-client plans contain `megabyte-automation` only.
- Existing local and unrelated remote servers remain byte-equivalent after semantic merge.
- Plans reject duplicate/colliding managed names and unsupported syntax before any write.
- Apply is atomic and mode-safe, produces a metadata-only receipt, and rollback refuses post-install drift.
- Client-native list/health commands verify the installed endpoint without printing credential values.

## Authorization boundary

This proposal records the discovered gap and safe implementation path. It does not authorize changing live client configuration before these acceptance checks exist.
