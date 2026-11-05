# Specification: Langfuse Fail-Open Telemetry & Parallel Triad Provisioning

## ADDED Requirements

### Requirement: Bounded Timeout & Fail-Open Langfuse Environment
Every managed workstation and server shell SHALL export `LANGFUSE_TIMEOUT_MS=2500`, `LANGFUSE_FAIL_OPEN=true`, `LANGFUSE_FLUSH_AT=10`, and `LANGFUSE_SPOOL_DIR="${MEGABYTE_CACHE_ROOT}/ai/langfuse-spool"` so Langfuse outages never block CLI or agent execution.

#### Scenario: Langfuse is unreachable

- **WHEN** a managed CLI or agent cannot reach Langfuse within 2500ms
- **THEN** execution continues, telemetry is boundedly spooled, and the outage does not fail the caller

### Requirement: Parallel Triad OpenSpec & Paperclip Registration
All durable system/dotfile updates inferred during a prompt pass SHALL be committed to `install.doctor`, governed by a Frontier-authored OpenSpec change (`claude` / `codex` / `antigravity` — never `opencode`), and linked to an issue in the `install.doctor` Paperclip project (`d97b0204-ca63-4117-b469-2fe0f2470d18`).

#### Scenario: Durable workstation configuration changes

- **WHEN** a prompt pass changes reusable shell, service, or dotfile behavior
- **THEN** the Install Doctor change has Frontier-authored OpenSpec artifacts and a linked Paperclip issue before closure
