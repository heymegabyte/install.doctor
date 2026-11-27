# Design

**Architect Role:** assigned

## Observed state (sanitized)

- Codex uses `~/.codex/config.toml`, preserves eight local/singleton entries, and currently has `megabyte-canary`; it has no `megabyte-primary`.
- Claude Code uses `~/.claude.json` with local and unrelated remote entries; it has no canonical managed entry. Claude Desktop has no `mcpServers` block.
- OpenCode uses `~/.config/opencode/opencode.jsonc` with six declared servers and no canonical managed entry.
- Cursor uses `~/.cursor/mcp.json` with one local `cua-driver` entry and no canonical managed entry.
- `~/.config/mcp-portals/host-profile.json` is absent.
- The pinned `macos-human` and `macos-automation` artifacts both grant only `megabyte-os-public`, but their northbound endpoint and authentication modes differ.

No secret values were read or recorded.

## Adapter and selection model

Select one pinned profile by explicit caller class before rendering. Codex, Claude Code/Desktop, OpenCode, and Cursor default to human. LiteLLM and OpenClaw are automation and require successful resolution of the pinned runtime secret references at apply time. Never place an automation entry into a human-client file.

Render each native schema independently: TOML tables for Codex, `mcpServers` for Claude and Cursor, and `mcp` with `type: remote` for OpenCode. JSONC editing must preserve comments or fail closed; parsing and reserializing it as JSON is not acceptable.

## Safe apply sequence

1. Load and digest-verify the pinned `macos-human` artifact.
2. Parse all selected clients without mutation and emit a metadata-only plan containing paths, selected profile, existing/desired digests, preserved entry names, and collision results.
3. Require an explicit apply flag and unique receipt path.
4. Snapshot every predecessor with mode `0600`, write temporary siblings, fsync where supported, and rename atomically.
5. Run native client listing/parse verification and confirm `megabyte-primary` resolves to `https://mcp.megabyte.space/mcp` while preserved entries remain present.
6. On any failure, restore every predecessor. Later rollback must verify installed digests before restoration.

## Apply decision

The client-native adapters and caller-class gate now satisfy the recorded safety conditions. The reviewed macOS plan selected `macos-human` only, preserved all enumerated entries, and added `megabyte-primary` to the five supported client files. Created and rewritten files are mode `0600`; a metadata-only rollback receipt protects all five predecessors, and the post-apply plan is idempotent.
