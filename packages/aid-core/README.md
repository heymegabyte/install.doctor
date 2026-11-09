# Desktop Tools core contracts

**Status: pre-production core, not a working OpenCode fork, daemon, web application, or hosted routing service.**

The product target is Desktop Tools at `desktop.tools`; personalized bootstrap profiles use
`https://<profile>.desktop.tools`, and the intended OpenCode-derived executable is `desktop-tools`.
`Install Doctor` and `aid` are compatibility and historical names, not a second product.
This isolated package implements deterministic building blocks without installing software,
starting processes, modifying a workstation, or contacting an AI provider.

## Implemented and tested

- Strict v1 and v2 desired-state schemas; unknown fields fail instead of disappearing on export.
- Single-file `ENVIRONMENT.md` import/export and canonical SHA-256 content digests, with explicit
  v1-to-v2 migration, role package overlays, and per-machine package add/remove exceptions.
- Proposed OpenCode provider configuration for the Desktop Tools endpoint, with eight
  ProjectSites routing aliases and an environment-variable token reference.
- Policy-oriented route selection, including restricted-data precedence and explicit premium opt-in.
- Tenant-scoped session metadata and legal lifecycle transitions.
- Streaming asciicast v3 formatting for already-sanitized output, resize, marker, and exit events.
- Per-machine Loki reconciliation plans with stable keys for a future durable deduplication store.
- Managed Grafana Alloy fragments using credential references, not inline secrets.
- Digest-bound portable Desktop Tools profile exports derived from schema-v4 `ENVIRONMENT.md`.
  They contain effective desired state and immutable recipe SHA-256 references, but exclude
  source machine identities, service endpoints, credential references, and secret references.
  A standalone target supplies its own validated host facts before materializing engine input.

The current test count is reported by `npm test`; do not copy a stale count into product claims.

## Run

```bash
npm install
npm test
```

There are no runtime dependencies. TypeScript is the sole development dependency.
The downloadable bundle also includes compiled `dist/` files so its tests can be run
with `node --test test/core.test.mjs` without building. No root privileges are needed.

## Important boundaries

The schemas export every setting they support, **not every eventual product setting**. V1 covers basic
machines, package IDs, routing policy, skill pins, privacy, and Loki bindings. V2 adds role package
overlays and per-machine package exceptions through an explicit migration; import never upgrades a
document implicitly. Recipe/config snapshots, automations, retention, maintenance windows, permissions,
budgets, and team policy remain absent and must be added through explicit schema versions before claiming
complete product export.

Portable profile exports are deliberately narrower than `ENVIRONMENT.md`; they are a derived
standalone projection, never a competing configuration authority. Their content digest detects
tampering but is not a signature. Import validates the strict schema and digest before a fresh
target can bind its own host identity, OS, role, and capabilities. Engine parity tests reproduce
the same normalized plan digest from the serialized export without carrying source-host identity.

A SHA-256 digest detects content changes; it is not a signature or proof of trust.
Commit pins are syntax-checked, not fetched or verified. The synthetic test fixture uses an
all-zero commit and example.invalid endpoints; it must never be deployed as a real configuration.

The proposed `/api/ai/v1` endpoint and experimental HTTP adapters in the control-plane are not deployed or verified as part of the bootstrap, provisioner, or site runtime. No DeepSeek credentials,
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

- Browser-first Desktop Tools management; headless operation remains first-class.
- Preserve chezmoi, software.yml, existing OS/role paths, and explicit local configuration ownership.
- Reuse the shared ProjectSites routing policy/service; default to DeepSeek. No LiteLLM layer.
- Select hiSHtory instead of Atuin; do not delete or migrate existing history without verification.
- Use Grafana Alloy for new Loki integrations, not end-of-life Promtail.
- Automatically materialize approved, pinned agent-skills; load only relevant skills into context.
- One canonical desired-state Markdown file; observed state and execution evidence remain separate.
- Every Desktop Tools execution, including local CLI and scheduled runs, must register a History session.
- Do not reintroduce Nix, force GUI prerequisites, or background-replace running applications.

See `docs/PRODUCT-SPEC.md` for the architecture, 30 prioritized improvements, acceptance
criteria, research sources, and a bounded improvement loop. No production deployment is implied.
