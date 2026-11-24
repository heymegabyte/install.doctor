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

### Requirement: Safe prompt closeout and cross-repository contribution sync
Before a prompt is complete, the agent SHALL implement every safe, authorized, dependency-closed recommendation; concurrently evaluate applicable contributions to `theme.tools`, `install.doctor`, `agent-skills`, and relevant touched projects; and update affected documentation and explanatory comments. It SHALL report blocked, unsafe, unauthorized, or inapplicable work truthfully rather than broadening authority.

#### Scenario: A prompt reveals reusable work

- **WHEN** an implementation produces reusable components, provisioning policy, agent guidance, or project-specific follow-up
- **THEN** applicable independent contributions are implemented and verified in their canonical repositories in parallel, while non-applicable or blocked recommendations are recorded explicitly

### Requirement: Five-provider observability by design
Applicable product designs SHALL include consent-aware PostHog, GA4, and GTM analytics, correlated Langfuse AI tracing, and Sentry error/performance telemetry with redaction, tenant and environment isolation, bounded fail-open delivery, and executed verification.

#### Scenario: An instrumented surface is declared complete

- **WHEN** a product or operator surface emits analytics, AI traces, errors, or performance data
- **THEN** consent and revocation, correlation, redaction, provider delivery, and outage behavior are verified without treating configuration or instruction text as production proof
