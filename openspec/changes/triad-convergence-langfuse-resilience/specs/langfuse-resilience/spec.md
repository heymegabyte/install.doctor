# Specification: Langfuse Fail-Open Telemetry & Parallel Triad Provisioning

## Requirements

### Requirement: Bounded Timeout & Fail-Open Langfuse Environment
Every managed workstation and server shell SHALL export `LANGFUSE_TIMEOUT_MS=2500`, `LANGFUSE_FAIL_OPEN=true`, `LANGFUSE_FLUSH_AT=10`, and `LANGFUSE_SPOOL_DIR="${MEGABYTE_CACHE_ROOT}/ai/langfuse-spool"` so Langfuse outages never block CLI or agent execution.

### Requirement: Parallel Triad OpenSpec & Paperclip Registration
All durable system/dotfile updates inferred during a prompt pass SHALL be committed to `install.doctor`, governed by a Frontier-authored OpenSpec change (`claude` / `codex` / `antigravity` — never `opencode`), and linked to an issue in the `install.doctor` Paperclip project (`d97b0204-ca63-4117-b469-2fe0f2470d18`).
