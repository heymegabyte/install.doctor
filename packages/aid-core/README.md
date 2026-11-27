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
- Digest-bound v2 portable Desktop Tools profile exports derived from schema-v4 `ENVIRONMENT.md`.
  They contain effective desired state, immutable recipe SHA-256 references, and only the secret
  requirement IDs/lifecycle/offline-recovery policy needed for deterministic preflight. They exclude
  source machine identities, service endpoints, secret-store locations, credentials, and secret values.
  A standalone target supplies its own validated host facts before materializing engine input. Legacy
  v1 exports require explicit migration and re-export before claiming offline-secret readiness.

The current test count is reported by `npm test`; do not copy a stale count into product claims.

## Run

```bash
npm ci
npm run typecheck
npm run build
npm run lint
npm test
```

The build uses the base compiler profile from the qualified `@theme-tools/testing`
1.0.2 archive at theme.tools revision `08b6d16a1bb7c4da9eb11ec741720c5ec078a551`.
`vendor/theme-tools/tsconfig.base.json` is the exact `package/dist/tsconfig/base.json`
member. Its SHA-256 is `6f72381362b2ee9b97227b5a775ff3234dcf9df7e11d0c1c240be77ef650b713`.
The Control Plane tooling project uses `vendor/theme-tools/tsconfig.node.json`
from the same archive (archive SHA-256
`b1f0d3c467b1f584255b05fd1fbb7f75cc96a3e96fceb169b9b24b315b8b1da9`).
This file is the exact `package/dist/tsconfig/node.json` member, exported as
`@theme-tools/testing/tsconfig/node.json`. Its SHA-256 is
`2e5e79d3d127cc0530302475dbf54089b3f88a22e01241e73a89d1ef1c2aadb9`.

Aid Core keeps its own emit and library settings. Zod is its runtime dependency.
TypeScript and ESLint are development dependencies. Use Node 24.22.2 to match
the Linux CI toolchain when running the lint and test commands.

The strict typed ESLint configuration uses the qualified `@theme-tools/testing`
1.0.2 archive at theme.tools revision `77dc59ef311c3e6eb6916b92b4e0424b52bed27c`.
Its SHA-256 is `c36d17107b474b4c93a2be1974f48ec67644e27632d55d03c91f84a529d3c696`.
The eight JavaScript files in `vendor/theme-tools/` are unmodified
`package/dist/<filename>` members, and the license is `package/LICENSE`.
To refresh them, extract those same members from a verified replacement archive
and update the pinned development dependencies to match. The local ESLint
configuration selects the source and test TypeScript projects.
`npm test` builds the declarations before linting the tests against them,
and Linux CI runs that same command.
The downloadable bundle also includes compiled `dist/` files so its tests can be run
with `node --test test/core.test.mjs` without building. No root privileges are needed.

After staging changes to an offline store's tracked template filenames, run
`npm run build` and `npm run inventory:refresh` from this package, then stage the
updated inventory. `npm run inventory:check` verifies the Git index without
reading template contents. Linux CI runs the index check explicitly. The runtime
test also verifies the checkout's file
inventory.

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
Recipe references are not accepted as trust merely because they contain a digest: the installer
export path verifies the exact signed-release catalog bytes, resolves the applicable dependency
closure through the existing strict load-plan schema, and pins each canonical catalog entry.
`desktop-tools-profile-export preflight-offline` reports missing escrow requirement IDs and exits 3
until each is declared available; it never resolves or prints a value or Infisical location. Actual
execution must still obtain each declared value through its separately authorized protected channel.

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

The test command builds the package, typechecks the Node tests and their fixtures
with `tsconfig.test.json`, then runs the runtime suite.
