# aid: Install Doctor environment-engineering foundation

**Status: pre-production core, not a working OpenCode fork, daemon, web application, or hosted routing service.**

The product target is `app.install.doctor`, with Machines, App Store, Recommendations,
Automations, and History. The future OpenCode-derived executable is named `aid`.
This isolated package implements deterministic building blocks without installing software,
starting processes, modifying a workstation, or contacting an AI provider.

## Implemented and tested

- Strict v1 desired-state schema; unknown fields fail instead of disappearing on export.
- Single-file `ENVIRONMENT.md` import/export and canonical SHA-256 content digests.
- Proposed OpenCode provider configuration for an Install Doctor endpoint, with eight
  ProjectSites routing aliases and an environment-variable token reference.
- Policy-oriented route selection, including restricted-data precedence and explicit premium opt-in.
- Tenant-scoped session metadata and legal lifecycle transitions.
- Streaming asciicast v3 formatting for already-sanitized output, resize, marker, and exit events.
- Per-machine Loki reconciliation plans with stable keys for a future durable deduplication store.
- Managed Grafana Alloy fragments using credential references, not inline secrets.

`npm test` passes **52 tests** with Node 22.16.0 and TypeScript 5.8.3 in the authoring environment.

## Run

```bash
npm install
npm test
```

There are no runtime dependencies. TypeScript is the sole development dependency.
The downloadable bundle also includes compiled `dist/` files so its tests can be run
with `node --test test/core.test.mjs` without building. No root privileges are needed.

## Important boundaries

The v1 schema exports every setting it supports, **not every eventual product setting**.
It currently covers basic machines, package IDs, routing policy, skill pins, privacy, and Loki bindings.
Role inheritance, recipe/config snapshots, automations, retention, team policy and migration
contracts must be added through explicit schema versions before claiming complete product export.

A SHA-256 digest detects content changes; it is not a signature or proof of trust.
Commit pins are syntax-checked, not fetched or verified. The synthetic test fixture uses an
all-zero commit and example.invalid endpoints; it must never be deployed as a real configuration.

The proposed `/api/ai/v1` endpoint is not deployed or verified. No DeepSeek credentials,
Cloudflare account credentials, or model requests are created here. Provider configuration
must be tested against a pinned OpenCode release and the real ProjectSites routing service.
Route selection is not budget enforcement, tenant authorization, or execution permission.

Session records are plain values; a daemon must durably persist them before spawning.
`CastWriter` is a formatter, **not a PTY, recorder, redactor, encryption layer, or browser player**.
It does not capture keyboard input, but displayed terminal output may still contain secrets.
The caller must handle consent, sanitization, storage failures, retention, and access control.

Loki integration functions produce plans and configuration text only. They do not discover
Coolify services, fetch secrets, install Alloy, validate using the Alloy binary, run health
checks, configure Grafana data sources, or coordinate live machines.

## Product decisions

- Browser-first management at `app.install.doctor`; headless daemon plus optional desktop companion.
- Preserve chezmoi, software.yml, existing OS/role paths, and explicit local configuration ownership.
- Reuse the shared ProjectSites routing policy/service; default to DeepSeek. No LiteLLM layer.
- Select hiSHtory instead of Atuin; do not delete or migrate existing history without verification.
- Use Grafana Alloy for new Loki integrations, not end-of-life Promtail.
- Automatically materialize approved, pinned agent-skills; load only relevant skills into context.
- One canonical desired-state Markdown file; observed state and execution evidence remain separate.
- Every aid execution, including local CLI and scheduled runs, must register a History session.
- Do not reintroduce Nix, force GUI prerequisites, or background-replace running applications.

See `docs/PRODUCT-SPEC.md` for the architecture, 30 prioritized improvements, acceptance
criteria, research sources, and a bounded improvement loop. No production deployment is implied.
