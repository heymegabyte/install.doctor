# Tasks: Parallel Triad Convergence, Langfuse Fail-Open Telemetry & Paperclip OpenSpec Sync

## 1. Shell & CLI Resilience
- [x] 1.1 Export `LANGFUSE_TIMEOUT_MS=2500`, `LANGFUSE_FAIL_OPEN=true`, `LANGFUSE_FLUSH_AT=10`, and `LANGFUSE_SPOOL_DIR` in `home/dot_config/shell/megabyte-cache.sh.tmpl`.
- [x] 1.2 Add `home/dot_local/bin/executable_langfuse-safe-ping` for bounded-timeout health checks and local JSONL spool replay.
- [x] 1.3 Update `AGENTS.md` with the Parallel Triad End-of-Turn Sync, Frontier OpenSpec Architect gate (`claude`/`codex`/`antigravity` — never `opencode`), and Paperclip issue handoff rules.

## 2. Verification & Fleet Rollout
- [x] 2.1 Verify `bash tests/test-workstation-guards.sh` and `langfuse-safe-ping` execution.
- [x] 2.2 Sync OpenSpec change to Paperclip project `install.doctor` (`d97b0204-ca63-4117-b469-2fe0f2470d18`) on `ubuntu.megabyte.space`.
- [ ] 2.3 Enroll workstation OpenClaw worker heartbeats into the Paperclip fleet registry via `executable_post-workstation.sh`.
