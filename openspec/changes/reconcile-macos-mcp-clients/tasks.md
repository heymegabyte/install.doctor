# Tasks

- [x] MC-1 (Owner: change owner; Depends: none; Paths: observed workstation state) Inventory Codex, Claude, OpenCode, Cursor, host descriptor, and running MCP-related processes without reading or recording secret values.
- [x] MC-2 (Owner: change owner; Depends: MC-1; Paths: current consumer) Compare live schemas and caller classes with the pinned macOS manifests and record the unsafe-apply blockers.
- [ ] MC-3 (Owner: future change owner; Depends: MC-2; Paths: scripts/tests) Implement native Codex TOML, Claude JSON, Cursor JSON, and comment-preserving OpenCode JSONC adapters with explicit human/automation selection.
- [ ] MC-4 (Owner: future change owner; Depends: MC-3; Paths: scripts/tests) Add multi-file atomic apply, metadata-only receipts, collision tests, mode checks, failure injection, and drift-safe rollback.
- [ ] MC-5 (Owner: future change owner; Depends: MC-4; Paths: live macOS clients) Plan, review, apply the human profile, verify native client discovery, and retain the receipt for rollback.
