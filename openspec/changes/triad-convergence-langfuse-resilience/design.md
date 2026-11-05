# Design: Install Doctor Langfuse Fail-Open Defaults & Parallel Triad Integration

> **Architect:** codex
> **Architect Role:** assigned

## Architecture

1. **Shell Environment Contract (`home/dot_config/shell/megabyte-cache.sh.tmpl`)**:
   - Every interactive and non-interactive shell sourcing `megabyte-cache.sh` inherits `LANGFUSE_TIMEOUT_MS=2500`, `LANGFUSE_FAIL_OPEN=true`, `LANGFUSE_FLUSH_AT=10`, and `LANGFUSE_SPOOL_DIR="${MEGABYTE_CACHE_ROOT}/ai/langfuse-spool"`.
   - Ensures all Node/TypeScript, Bun, and LiteLLM client invocations across macOS, Legion, Omen, and Ubuntu respect a hard 2.5s timeout and spool locally under `~/.cache/megabyte/ai/langfuse-spool` if Langfuse is down.
2. **Fail-Open Health & Spool Replay CLI (`home/dot_local/bin/executable_langfuse-safe-ping`)**:
   - Invokes `~/.agentskills/bin/lib/langfuse-safe.ts` under Node 24 native strip-types when available (with a `curl --max-time` fallback) and outputs structured JSON without ever failing a caller script.
3. **Paperclip Project Linkage**:
   - Linked to Paperclip project `install.doctor` (`d97b0204-ca63-4117-b469-2fe0f2470d18`) via `openspec-paperclip-sync.ts`.
