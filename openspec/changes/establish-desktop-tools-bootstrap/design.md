# Design

## Context

See `proposal.md` for motivation. The repository currently combines a mature cross-platform desired-state tree, a partially integrated installer engine, an aid-core contract package, and a live Cloudflare control-plane skeleton. The public `/start` route fails closed because no trusted stable release is active; real device mutation is intentionally unavailable from the server. Pairing, signed-release publication, environment schemas, event rendering, and OpenCode-oriented contracts exist at different maturity levels.

The change crosses naming, DNS, release trust, enrollment, authorization, OpenCode startup, mutation authority, portable configuration, evidence, and migration. It must preserve existing user files and working provisioning paths until verified replacements exist. A full SaaS visual redesign remains separately gated by approved design work.

## Goals / Non-Goals

**Goals:**

- Deliver the exact `curl -fsSL https://<profile>.desktop.tools | bash` contract for graphical and headless targets.
- Make the profile subdomain permanent and shareable without treating it as a credential.
- Require explicit cross-device approval before a new machine receives scoped authority.
- Launch a pinned OpenCode runtime with a versioned provisioning prompt and minimum capabilities.
- Keep deterministic planning, mutation, journaling, rollback, and verification in the installer engine.
- Preserve portable profiles and a standalone recovery path independent of the hosted service.
- Migrate existing Install Doctor and aid state without destructive renames or false capability claims.

**Non-Goals:**

- Exposing OpenCode's programmatic server directly to the Internet.
- Giving a language model unrestricted shell, root, secret, filesystem, or network access.
- Encoding enrollment credentials or secrets in profile names, DNS, HTML, or stage zero.
- Replacing all existing mutation paths before parity and real-host evidence exist.
- Implementing the final visual Desktop Tools application without approved designs.
- Making paid AI inference a prerequisite for deterministic provisioning or recovery.

## Decisions

### 1. Wildcard subdomains identify profiles, not principals

Cloudflare wildcard DNS and TLS route `<profile>.desktop.tools` to one bootstrap handler. The handler validates a normalized, reserved-name-aware profile slug and resolves an immutable public profile descriptor. Tenant and owner identity come only from authenticated server state during approval.

Alternative: make an unguessable subdomain a bearer secret. Rejected because URLs leak through shell history, DNS, logs, proxies, support transcripts, and copy/paste.

### 2. The root response is a minimal stage-zero script

The endpoint returns a cache-controlled shell launcher containing only the profile identifier, trusted public roots, bounded fetch policy, and release-channel bootstrap logic. It downloads into a private temporary directory, verifies before execution, and never falls back to a moving branch or inline mutable implementation.

Alternative: embed the entire provisioner and configuration in the response. Rejected because it increases the unauthenticated attack surface and makes independent signing, offline reuse, rollback, and provenance verification harder.

### 3. Device authorization uses a separate approval device

The target generates its key material and private polling secret locally, starts a bounded authorization request, and displays a human code plus approval URI. The owner signs in on another device and sees the matching code, device fingerprint, profile, requested scopes, and expiry. Approval permits one atomic claim of a short-lived, device-bound credential.

The protocol follows device-authorization properties without depending on the profile URL as authority. Polling uses interval guidance, bounded retries, normalized errors, replay denial, and no controller-store fallback.

Alternative: require target-browser OAuth. Rejected because headless machines are first-class. Alternative: unattended permanent profile credentials. Rejected because compromise would authorize unlimited machines.

### 4. OpenCode is pinned and private

The verified release supplies a pinned OpenCode distribution and a Desktop Tools configuration that binds its server locally. The supervisor starts it with a minimized environment, scoped session token, selected skills, exact prompt version, and typed Desktop Tools tools. Provider access uses the product's approved routing boundary and a short-lived inference credential distinct from device/control-plane authority.

Alternative: expose `opencode serve` through the public Worker. Rejected because the control plane must mediate authorization, tenancy, capability grants, and evidence.

### 5. The agent orchestrates; the engine mutates

The prompt asks OpenCode to discover, explain, plan, request approval, invoke tools, verify, and report. Every state-changing tool compiles to the installer engine's strict task schema and plan digest. The engine owns locks, privilege brokering, secrets delivery, journal fencing, retries, compensation, verification, and terminal status. Free-form shell remains read-only or denied unless represented by an explicitly approved typed capability.

Alternative: permit the model to execute provisioning shell commands directly. Rejected because model text is neither authorization nor durable desired state.

### 6. Profile resolution produces one portable desired state

Desktop Tools stores a versioned profile model and exports it as the repository's canonical `ENVIRONMENT.md` format. Hosted state contains secret references, not secret values. The approved machine receives the exact nonsecret revision plus only the minimum resolved secrets needed for the current plan. Exported profiles and signed offline bundles support recovery without Desktop Tools.

Alternative: generate a bespoke shell script per profile. Rejected because it destroys declarative diffs, portability, idempotency, and cross-platform validation.

### 7. Sessions and evidence exist before agent launch

Authorization creates a run intent, but the supervisor must durably persist History and recording headers before starting the PTY or agent. All events correlate profile revision, release, machine, actor, authorization, prompt, OpenCode version, skills, tool versions, plan, approvals, output gaps, costs, and verification. Recording output is consented and sanitized before remote persistence; raw keyboard input is excluded by default.

### 8. Migration is additive and evidence-gated

Desktop Tools initially ships alongside existing paths. Compatibility shims recognize legacy commands, environment variables, state directories, and profile files; they preserve data and emit deterministic migration plans. Public branding and default URLs switch only after signed bootstrap activation, one verified platform cell, device authorization, and a complete agent-to-engine canary pass. Legacy removal requires a separately documented deadline and telemetry/evidence showing safe migration.

## Risks / Trade-offs

- **Wildcard profile enumeration or reserved-name capture** -> Normalize slugs, reserve infrastructure names, rate-limit lookups, return privacy-equivalent failures, and never expose private profile metadata publicly.
- **`curl | bash` obscures trust to users** -> Keep stage zero tiny and inspectable, publish verification instructions and hashes, verify before execution, and support download-then-run/offline alternatives.
- **Cross-device phishing** -> Display and compare the human code, machine fingerprint, profile, requested scopes, and actor on both surfaces; never auto-approve from a QR code alone.
- **OpenCode or model compromise** -> Pin provenance, isolate the server, minimize environment and permissions, require typed tools, and make the engine independently revalidate every plan and effect.
- **Hosted-service outage blocks first use** -> Preserve exported desired state, trusted releases, offline bundles, and local deterministic recovery paths.
- **Rename breaks existing users and automation** -> Use additive aliases, discovery-only migration, explicit state ownership, compatibility tests, and a bounded deprecation window.
- **Two product surfaces drift during migration** -> Generate capability/branding status from one registry and remove claims that lack live evidence.
- **Approval delays feel less automatic** -> Make target polling and resume durable; allow separately scoped one-time automation credentials later without weakening the default flow.

## Migration Plan

1. Introduce Desktop Tools naming, state schemas, slug rules, capability registry, and compatibility mappings without changing live defaults.
2. Activate a signed release containing the pinned OpenCode runtime, stage-zero verifier, supervisor boundary, and deterministic tools.
3. Add wildcard profile routing and public nonsecret descriptors while all enrollment remains disabled.
4. Enable cross-device authorization for a disposable tenant and verified canary machine.
5. Run a complete profile-to-OpenCode-to-engine lifecycle on one supported platform, including denial, expiry, interruption, unchanged rerun, rollback, and offline recovery.
6. Promote `*.desktop.tools` as the default documented path and retain legacy redirects/shims with deprecation telemetry.
7. Migrate existing user-controlled state only through previewed, reversible ownership-aware operations.
8. Remove legacy product surfaces only after the compatibility window and a separately approved removal gate.

Rollback at every phase restores the previous routing/default documentation and disables new enrollment. Activated signed releases and evidence remain append-only; rollback never deletes user configuration or historical verification material.
