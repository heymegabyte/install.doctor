# Value-free verification evidence

**Date:** 2026-11-27

## Fixture verification

- Pinned artifact digest and profile validation passed.
- Codex TOML, Claude Code JSON with nested project MCP state, Claude Desktop JSON without an existing MCP object, OpenCode JSONC with comments, and Cursor JSON fixtures passed.
- Each adapter preserved unrelated source bytes, added only the selected managed entry, and was idempotent on a second render.
- Foreign managed-name collisions and malformed JSONC failed before writes.
- Five-file transaction, mode-`0600` rewritten and newly created configs, mode-`0600` content-free receipt, exact rollback, and human/automation selection checks passed.

## Reviewed live plan

- Host class: `macos-workstation`.
- Caller class: `human`.
- Selected profile: `macos-human` from pinned canonical revision `0aec9a5122bcae994cae1a5bf9cc494c56f9b1d5`.
- Desired managed name: `megabyte-primary`.
- Planned additions: exactly one entry in Codex, Claude Code, Claude Desktop, OpenCode, and Cursor.
- Preserved server counts: Codex 9, Claude Code 10, Claude Desktop 0, OpenCode 6, Cursor 1.
- No `megabyte-automation` entry was planned.

## Applied and verified state

- Five files were installed atomically and are mode `0600`.
- The receipt is mode `0600`, contains five records and no installed file content, and retains predecessor snapshots for rollback.
- A post-apply plan reported all five outputs unchanged with identical existing and desired digests.
- Codex's native MCP parser reports `megabyte-primary` as enabled Streamable HTTP at the canonical primary endpoint.
- Claude Code, Claude Desktop, OpenCode, and Cursor native documents parse and expose the same canonical primary remote entry.
- All five files contain no `megabyte-automation` entry.
- Codex completed the primary portal OAuth flow through the existing Cloudflare Access session.
- A fresh Codex process discovered exactly the three read-only Megabyte OS tools plus the three portal-selection tools; an explicitly approved call to `megabyte_os_public_about_megabyte_os` completed successfully.
- The first non-interactive probe correctly refused execution under an approval policy of `never`, demonstrating that client approval remains an independent enforcement layer rather than an authentication failure.
- Claude and OpenCode health-list commands did not return within the bounded verification window; configuration parsing and idempotent digest verification passed, but live upstream authentication is not claimed.

No credential values or file contents are recorded here.
