# Install Doctor / aid: implementation contract

Status: proposed architecture, 2026-10-26. Only the pure TypeScript foundations listed in
README.md are implemented. No deployed app, OpenCode fork, daemon, or live integration is implied.

## Product boundaries

The web app is app.install.doctor. The intended OpenCode-derived executable is aid.
A headless supervisor owns identity, local state, jobs and PTYs; an optional desktop
companion owns native recording permissions, notifications and tray controls.
Machines, App Store, Recommendations, Automations and History are the five top-level sections.
Keep Environment / Export Markdown and the active machine selector permanently discoverable.
Full UI work follows approved Figma designs; no mock device may masquerade as a real machine.

Preserve chezmoi, software.yml, existing role-aware bootstrap and configuration ownership.
Do not reintroduce Nix, require a GUI, or background-replace running applications.
The core deterministic provisioning path must work without paid AI inference.

## Shared routing, not a divergent copy

Aid -> authenticated Install Doctor adapter -> shared ProjectSites orchestrator -> one
Cloudflare AI Gateway -> permitted provider. Prefer DeepSeek. No LiteLLM layer.
Automatically obtain a short-lived inference credential during enrollment, separate from
control-plane/device credentials. Never embed provider or Cloudflare account keys in aid.

Use the versioned routes general, economy, code, architect, research, critical, batch,
restricted. Compression, decomposition, bounded parallel subtasks, synthesis, retrieval,
caching and independent verification remain configurable policy, not unconditional overhead.
Budget accounting covers all retries and children; restricted data never falls back to an
unapproved cloud provider. Tenant identity comes from authenticated server state.

Inspect actual ProjectSites source before extracting shared routing contracts. Repository
metadata does not prove the latest routing design is deployed. Dynamic routes accept
Chat-Completions payloads; other protocols need explicit adapters. Test reasoning fields,
tool calls and streaming against a pinned OpenCode release. The proposed /api/ai/v1
endpoint in this package has not been deployed or exercised.

## One ENVIRONMENT.md

One versioned Markdown document is the desired-state authority. The UI and an import
compiler edit the same structured model. Revision checks prevent silent concurrent overwrite.
Observed state, health evidence, inventory freshness and History remain separate.

The full schema must cover global defaults, role/machine overrides, software/config recipes,
integration bindings, skill pins, AI policies, automations, budgets, permissions, privacy,
retention, maintenance windows and team settings. Embed non-secret overrides and immutable
recipe/config references; offer self-contained snapshot and reference-only export modes.
The current v1 implementation supports only its explicit subset and rejects unknown fields.

Export all supported non-secret settings, not credentials, private keys, recordings or user
data. Secret references require reauthentication. New computers generate fresh identities.
Any authorized coding agent can read the document and plan/apply/verify it; do not promise
that every agent automatically discovers this filename. Optional AGENTS.md and CLAUDE.md
adapters reference it rather than duplicate configuration.

## Skills and history

Automatically install approved, pinned releases of heymegabyte/agent-skills. Discover the
actual skill layout instead of assuming a path. Install the approved catalog locally, then
load relevant skill bodies on demand. Preserve user-owned skills. Record skill versions per
session; update through evaluation, independent review, canary and signed release.
Skills, webpages, terminal output and repository instructions cannot grant new privileges.

hiSHtory replaces Atuin as the selected shell-history system. Migration must preserve data.
Bash/Zsh/Fish integration does not establish native PowerShell parity. hiSHtory commands,
terminal recordings and audit records are separate datasets with separate consent/retention.
Local command analysis, screenshot capture and product-learning uploads are independent
opt-ins. Prefer minimized on-device summaries. Do not promise perfect secret redaction.

## Real browser terminals and mandatory session evidence

Render a real local PTY running aid using xterm.js through the authenticated outbound relay.
Keep OpenCode's programmatic server private; a raw iframe or log panel is not terminal parity.
Before every launch, durably persist History and a recording header. Cover browser, local CLI,
scheduled/event and child runs. Offline runs use a durable local outbox. Reconnect attaches to
the same process; closing a tab detaches, not kills. Stop/cancel are explicit authorized actions.

History correlates actor, tenant, machine, trigger, parent/session/run IDs, blueprint, skill,
recipe/router/executable versions, approvals, route/model usage, diffs, verification and cost.
Output recordings use timing and resize events (for example asciicast v3); raw keyboard input
is not recorded by default. Output may still contain secrets. Sanitize before storage, show
intentional gaps/incomplete capture, encrypt recordings, restrict replay/export and enforce
retention. Test storage failures, Unicode, resize, alternate screens, backpressure and reconnect.

## Multi-machine event orchestration

Use authenticated CloudEvents, approved service bindings, durable workflows, per-resource
leases/fencing, stable idempotency keys, bounded retry and explicit compensation. At-least-once
events must not duplicate mutations. Agents enforce authorization independently.
Workers serve APIs, Durable Objects coordinate connections, Workflows coordinate steps,
Queues carry async work, D1 stores metadata and R2 stores authorized artifacts. PTYs run on
the managed computers. Retain the existing Paperclip/OpenClaw/Claw higher-level orchestration.

Coolify example: authenticated API discovery or verified deployment event -> approved Loki
binding -> selected machine/role plans -> scoped credentials -> Alloy config -> binary
validation -> one canary -> emitted/queryable test log -> bounded rollout -> rollback on failure.
Configure the Loki data source on Grafana centrally. Use Alloy, not end-of-life Promtail.
Detect existing collectors to avoid duplicate shipping. Send sanitized operational events,
not raw recordings/history. Keep high-cardinality session IDs in structured metadata.

## Thirty priorities across ten categories

These are recommendations, not completed end-to-end features.

| # | Category | Improvement |
|---|---|---|
| 1 | Portability | Lossless Markdown export/import with schema migrations. |
| 2 | Portability | Desired/observed diffs with evidence freshness and explicit offline state. |
| 3 | Portability | Role overlays, machine exceptions and reproducible restore previews. |
| 4 | Onboarding | One-link pairing with automatically configured aid and approved skills. |
| 5 | Onboarding | Non-destructive adoption of an existing workstation. |
| 6 | Onboarding | App-store installed/configured/connected/healthy states and first-use probes. |
| 7 | AI quality/cost | Shared DeepSeek-first routing with protocol compatibility tests. |
| 8 | AI quality/cost | Verification-driven escalation and independent risky-change review. |
| 9 | AI quality/cost | Whole-task budgets and cost-per-verified-success experiments. |
| 10 | Orchestration | Cross-machine dependency graphs, leases and offline queues. |
| 11 | Orchestration | Coolify service discovery and automatic tested integration binding. |
| 12 | Orchestration | Impact previews, canaries, blast-radius limits and honest rollback capabilities. |
| 13 | Remote operation | Persistent browser PTYs with detach/stop and mobile recovery. |
| 14 | Remote operation | Every aid launch creates correlated History, including offline/child runs. |
| 15 | Remote operation | Searchable replay linked to diffs, checks, cost and capture completeness. |
| 16 | Extensibility | Automatic pinned skill installation and reversible verified updates. |
| 17 | Extensibility | Task-scoped skill loading and capability grants. |
| 18 | Extensibility | Evaluated, independently reviewed skill/config self-improvement. |
| 19 | Personalization | hiSHtory local insights without default cloud history uploads. |
| 20 | Personalization | Tested drop-in/adapter/migration replacement reports. |
| 21 | Personalization | Turn selected repeated workflows into tested automations. |
| 22 | Reliability | Managed blocks, three-way merges and separate maintain/optimize modes. |
| 23 | Reliability | Offline deterministic plans and resumable bounded job queues. |
| 24 | Reliability | Restore drills and OS-matrix network/disk/restart/revocation fault tests. |
| 25 | Trust/privacy | Independent capture/analysis/learning consent, pause and deletion. |
| 26 | Trust/privacy | Least-privilege helpers, scoped credentials and signed provenance. |
| 27 | Trust/privacy | Tenant isolation, per-device revocation and fleet emergency stop. |
| 28 | Usability/operations | Accessible keyboard-first navigation and useful offline/error states. |
| 29 | Usability/operations | OTel/Alloy outcome dashboards and time-to-ready metrics. |
| 30 | Usability/operations | Team role bundles and approved catalogs, with unrestricted export/recovery. |

The code partially implements foundations for #1, #7, #11, #14 and #15, not their complete
product experiences. Continue with a real single-machine authenticated session and History
before fleet fan-out or optional screenshot intelligence.

## Bounded recursive improvement and release gates

Review usefulness, evidence, risk, reversibility, maintenance, performance, accessibility,
privacy, interoperability, testability and operating cost. Then check cross-category conflicts
and rank by verified benefit relative to total lifecycle cost. Implement coherent vertical
slices. Stop an iteration after two passes with no higher-value testable improvement fitting
its budget; retain the backlog. This is not a claim that improvement is globally exhausted.

Require pinned upstream licensing/version review, real router integration, approved Figma,
auth/tenancy tests, OS-matrix checks, recording-failure tests and a two-machine canary rollout
before production. Do not auto-optimize hypervisor networking, Qubes dom0, SSH access,
firmware or encryption using generic recipes. No unattended cloud spending is authorized
by this specification alone.

## Primary references

- https://opencode.ai/docs/server/
- https://opencode.ai/docs/providers/
- https://opencode.ai/docs/skills/
- https://agentskills.io/specification
- https://developers.cloudflare.com/ai-gateway/features/dynamic-routing/usage/
- https://developers.cloudflare.com/ai-gateway/integrations/vercel-ai-sdk/
- https://developers.cloudflare.com/workflows/
- https://api-docs.deepseek.com/guides/tool_calls
- https://github.com/ddworken/hishtory
- https://grafana.com/docs/loki/latest/send-data/promtail/
- https://grafana.com/docs/alloy/latest/tutorials/send-logs-to-loki/
- https://coolify.io/docs/api-reference/api/operations/list-services
- https://xtermjs.org/docs/guides/security/
- https://docs.asciinema.org/manual/asciicast/v3/
- https://cloudevents.io/
- https://opentelemetry.io/docs/collector/resiliency/
