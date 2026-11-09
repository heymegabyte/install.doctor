# Proposal

> **Architect:** codex
> **Architect Role:** assigned

## Why

The repository currently mixes a provisioning engine with an unfinished Install Doctor management product. The product is now Desktop Tools: a user should be able to publish a customized provisioning profile at a personal subdomain and provision a graphical or headless machine with one command, while preserving signed releases, explicit remote approval, deterministic mutation, and standalone operation.

## What Changes

- **BREAKING**: Rename the user-facing product, executable surfaces, documentation, and hosted management experience from Install Doctor/aid to Desktop Tools, with `desktop-tools` as the intended OpenCode-derived executable and an explicit compatibility and migration period for existing entrypoints and state.
- Make `https://<profile>.desktop.tools` a permanent, shareable, nonsecret bootstrap endpoint that can be invoked as `curl -fsSL https://<profile>.desktop.tools | bash`.
- Serve only a small signed stage-zero launcher at that endpoint; it verifies and installs a pinned OpenCode runtime plus the deterministic Desktop Tools provisioning tools rather than embedding credentials or the full mutable implementation in the response.
- Create a new machine identity, initiate a cross-device authorization flow, and allow the headless target to wait while an owner approves the displayed code, machine fingerprint, profile, and requested scopes from another device.
- Authorize an exact privileged-broker run through a dedicated online Ed25519 approval signer whose public authority is delegated by the protected release root, delivered in the immutable verified release closure, and independently validated by the root coordinator; offline runs use a separately selected and evidenced trusted-local approval path without silent downgrade.
- After approval, exchange the one-time authorization for scoped, short-lived credentials, load the profile's versioned nonsecret desired state, and launch OpenCode with a bounded provisioning prompt.
- Keep privileged and state-changing effects behind one deterministic installer-engine plan, consent, journal, verification, and rollback boundary. The enrolled user owns planning and the canonical run journal; an exact root-owned broker executes only approved privileged operations, while user-owned tasks never run as root. OpenCode may plan and orchestrate approved tools but may not improvise ambient privileged shell mutations.
- Keep Desktop Tools profiles portable and exportable so the provisioning engine remains usable without the hosted customization service.
- Remove or migrate the unfinished `app.install.doctor` management-product claims; do not represent pre-production aid contracts as a second product.

## Capabilities

### New Capabilities

- `desktop-profile-bootstrap`: Personalized wildcard-subdomain profile resolution, signed stage-zero delivery, portable profile retrieval, and compatibility behavior.
- `device-authorization`: Cross-device machine enrollment with human-verifiable codes, explicit approval, scoped credentials, expiry, denial, and replay resistance.
- `agent-provisioning-session`: Pinned OpenCode startup, bounded provisioning prompt execution, deterministic tool authority, and correlated session evidence.

### Modified Capabilities

- `fleet-bootstrap`: Replace the `app.install.doctor/start` product contract with the Desktop Tools profile-subdomain entrypoint while retaining safe curl-pipe handling, bounded execution, durable planning, and standalone recovery paths.

## Impact

- Hosted routing, wildcard DNS/TLS, Cloudflare Worker routes, device pairing, authentication, and release publication.
- Stage-zero bootstrap scripts, installer-engine adapters, OpenCode configuration, executable naming, durable state paths, and migration shims.
- `ENVIRONMENT.md`, profile export/import, software catalog, provisioning plans, History/recording evidence, documentation, site copy, tests, and OpenSpec contracts.
- Existing `app.install.doctor`, `install.doctor`, `aid`, environment-variable, state-directory, and command consumers require an explicit deprecation window and non-destructive migration.
- No permanent credential or secret may be encoded in a profile subdomain or returned by its unauthenticated bootstrap response.
