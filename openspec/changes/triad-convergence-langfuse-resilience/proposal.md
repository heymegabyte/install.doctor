# Proposal: Parallel Triad Convergence, Langfuse Fail-Open Telemetry & Paperclip OpenSpec Sync

> **Architect:** codex
> **Architect Role:** assigned

## Why

As part of the Parallel Triad Convergence mandate (`agent-skills` + `install.doctor` + `theme.tools`), any workstation, shell, telemetry, or CLI update inferred during a prompt pass must land in `heymegabyte/install.doctor` in parallel with `heymegabyte/agent-skills` and `heymegabyte/theme.tools`. Specifically, all managed workstations and servers (`macOS`, `legion.megabyte.space`, `omen.megabyte.space`, `ubuntu.megabyte.space`) need default environment guardrails for Langfuse fail-open telemetry (`LANGFUSE_TIMEOUT_MS=2500`, `LANGFUSE_FAIL_OPEN=true`, `LANGFUSE_SPOOL_DIR`) and a zero-blocking health/replay helper (`langfuse-safe-ping`).

## What Changes

1. Update `home/dot_config/shell/megabyte-cache.sh.tmpl` to export `LANGFUSE_TIMEOUT_MS=2500`, `LANGFUSE_FAIL_OPEN=true`, `LANGFUSE_FLUSH_AT=10`, and `LANGFUSE_SPOOL_DIR="${MEGABYTE_CACHE_ROOT}/ai/langfuse-spool"`.
2. Add `home/dot_local/bin/executable_langfuse-safe-ping` to probe Langfuse with a strict `2500ms` timeout and replay spooled JSONL traces when Langfuse recovers, always exiting `0` (fail-open).
3. Update `AGENTS.md` in `install.doctor` to codify the Parallel Triad End-of-Turn Sync (`agent-skills` + `install.doctor` + `theme.tools`), Frontier-only OpenSpec authoring (`claude` / `codex` / `antigravity` — never `opencode`), and automatic Paperclip issue registration.
