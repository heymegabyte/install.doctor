# Design

**Architect Role:** assigned

## Context

See `proposal.md` for motivation. The repository currently combines a mature chezmoi and shell provisioning estate with pre-production typed packages for contracts, installer execution, privileged brokerage, local supervision, and a Cloudflare control plane. Existing changes already own substantial parts of bootstrap, fleet backup/recovery, OnePrompt convergence, GPU inference, and live KasmVNC work; this program coordinates and completes them rather than creating parallel authorities.

The public product is Desktop Tools. Customer runtime inference uses ProjectSites without LiteLLM; internal engineering agents continue to use the canonical OpenCode-to-LiteLLM offload policy. The repository remains cross-platform, headless-safe, non-Nix, least-privilege, and evidence-driven. Existing live applications, host state, backups, and secrets must be preserved until a tested migration exists. Full SaaS visual implementation requires an approved Figma artifact.

## Goals / Non-Goals

**Goals:**

- Establish a dependency-ordered program that can land incremental verified vertical slices without fifty competing implementations.
- Preserve one source of desired-state truth and one mutation, release, identity, telemetry, and recovery authority per concern.
- Make platform, deployment, recovery, and product claims derivable from fresh machine-verifiable evidence.
- Permit independent work to proceed in parallel while serializing architecture, release, secret, storage, and overlapping repository decisions.
- Make every migration reversible at its configuration boundary and honest about non-reversible package, operating-system, network, storage, and external effects.

**Non-Goals:**

- Big-bang replacement of the legacy provisioner or live fleet.
- Automatic purchase or activation of paid services, destructive storage repair, production deployment, credential creation, or expansion to unenrolled hosts.
- Treating generated configuration, passing unit tests, a running process, or a started backup as proof of production operation.
- Implementing unapproved customer-facing visual designs.

## Decisions

### 1. Organize work as five dependency horizons

The program uses five horizons: trust foundation, production vertical slice, platform and operational expansion, product experience, and ecosystem scale. A horizon may overlap only when its inputs are already evidence-complete. This replaces a flat fifty-project backlog with a critical path.

Alternative considered: start all recommendations independently. Rejected because release, identity, event, desired-state, and mutation primitives would be duplicated and later require risky convergence.

### 2. Existing focused changes remain implementation owners

`establish-desktop-tools-bootstrap` remains the owner of the first production profile lifecycle and installer-engine cutover; `fleet-backup-recovery` remains the owner of storage, backup, Infisical recovery, and Loki host rollout; other active changes retain their bounded scopes. This program owns shared contracts, ordering, cross-change acceptance, and missing work only.

Alternative considered: absorb or supersede all active changes. Rejected because it would destroy attribution, repeat validated work, and create multiple writers over live-sensitive areas.

### 3. Installer-engine is the only eventual host mutation authority

Legacy scripts remain compatibility writers until individual effects are migrated. Each effect moves through observe, parity fixture, typed operation, broker and lock admission, interruption tests, canary, unchanged reapply, and legacy subtraction. Renderers, models, control-plane handlers, plugins, and profile compilers may propose operations but cannot execute mutations directly.

Alternative considered: keep shell as the primary executor behind a typed wrapper. Rejected because arbitrary shell cannot provide complete effect schemas, exact approvals, interruption reconciliation, or portable privilege boundaries.

### 4. Use one canonical lifecycle protocol

Strict versioned schemas in `aid-core` define profile, host facts, plan, operation, approval, event, journal, receipt, support evidence, telemetry, and recovery references. All renderers and services consume those schemas. Product-facing legacy names remain additive adapters and never become second schemas.

Alternative considered: independent browser, TUI, CLI, and offline protocols. Rejected because terminal semantics and recovery would drift.

### 5. Release trust uses delegated offline-rooted authority

Adopt TUF-style role separation and expiry while retaining the repository's Ed25519 and content-addressed release work. Root and recovery authority stay offline; scoped online roles publish platform and channel metadata. Build provenance, SBOM, reproducibility, publication, activation, monitoring, and revocation receipts are separate signed statements.

Alternative considered: one long-lived release key. Rejected because compromise would require replacing the root of trust and could not safely separate build, publication, or activation.

### 6. Cloudflare components follow their consistency needs

Stateless validation and public descriptors remain ordinary Worker routes. D1 stores queryable tenant and audit records. A per-host or per-session Durable Object owns serialized coordination and resumable WebSockets. Queues buffer independent fan-out. Workflows own durable multi-step release, enrollment, reconciliation, and recovery processes. R2 stores immutable artifacts and large evidence.

Alternative considered: keep all state and orchestration in one Worker plus D1. Rejected because request handlers are not a durable scheduler or connection owner.

### 7. Desired state and observed evidence remain separate

`ENVIRONMENT.md` and its strict compiled manifests remain portable intent. Discovery, health, receipts, benchmarks, and protection status remain observed evidence and never rewrite intent implicitly. A compiler produces deterministic host overlays and dependency closure without embedding secret values.

Alternative considered: treat the live fleet database as desired state. Rejected because it makes drift indistinguishable from policy and damages portability and disaster recovery.

### 8. Identity is workload-specific; Infisical is operational secret authority

Humans authenticate through the product's Cloudflare-first path with phishing-resistant step-up where applicable. CI and platforms use claim-bound OIDC. Hosts, services, and agents use distinct Infisical machine identities with immutable scope manifests. Authentik remains limited to documented local/offline human compatibility. Local secrets require an explicit offline-exception record; the independent recovery envelope is the only general age use.

Alternative considered: a shared controller credential or silent local fallback. Rejected because it defeats revocation, least privilege, and cross-host denial testing.

### 9. Platform support is a signed expiring evidence cell

A cell is keyed by product release, engine, platform, version, architecture, role, and capability. Promotion requires an independently attested lifecycle receipt from an approved fixture or canary. Code, policy, recipe, or evidence-age changes invalidate the relevant cells. Unit tests never promote a cell alone.

Alternative considered: documentation matrices maintained by hand. Rejected because existing documentation has already outpaced deployed capability.

### 10. Observability uses one semantic event envelope

Define bounded OpenTelemetry-compatible resource and event attributes shared by local journals, Alloy, Loki, metrics, traces, and dashboards. Run IDs remain fields where cardinality is unsafe. Collectors keep a minimal local recovery configuration and can accept validated remote modules without making telemetry availability a host-operation dependency.

Alternative considered: preserve package-specific log formats and dashboard parsing. Rejected because correlation, redaction, and status semantics would remain inconsistent.

### 11. Data protection is workload-aware and independently tested

ZFS snapshots, ZFS replication, file backups, database-native dumps, VM/container backups, and recovery escrow remain distinct protection layers. Policy compiles from a coverage map with explicit ownership, exclusions, objectives, dependencies, and destination boundaries. Restore drills, not job completion, establish recoverability.

Alternative considered: standardize every host on one filesystem or backup tool. Rejected because the fleet contains incompatible platforms and workload-native recovery semantics.

### 12. Supply-chain inventory and policy are release inputs

Normalize catalog recipes into a strict graph and emit SPDX 3 inventories plus separate evolving exploitability statements. External artifacts are admitted once into immutable storage. Extensions use the same provenance, compatibility, signature, capability, and revocation model as core artifacts.

Alternative considered: scan after release publication. Rejected because unresolved provenance or policy failures must prevent admission, not merely alert afterward.

### 13. OpenCode is embedded behind Desktop Tools authority

Use the upstream embedded SDK and permission/policy model as the replaceable execution substrate, with Desktop Tools owning release pinning, session identity, prompts, typed tools, recordings, provider policy, budgets, and upgrade compatibility. No public unrestricted OpenCode listener becomes a product boundary.

Alternative considered: indefinitely maintain an unconstrained source fork. Rejected because the product needs a narrow owned integration surface and an upstream migration path, not broad divergence.

### 14. User experiences follow protocol stability and design approval

Implement renderer-neutral engine and accessibility contracts before visual polish. The TUI can advance on the stable event protocol. The SaaS backend and information architecture may advance, but new visual UI implementation waits for explicit approval of the current Figma artifact.

Alternative considered: let the inherited site or thin admin pages define product behavior. Rejected because presentation must reflect deployed truth and cannot become a second domain model.

## Risks / Trade-offs

- **[Program breadth causes permanent partial completion]** -> Ship evidence-complete vertical slices, cap work in progress, and make the critical path visible.
- **[Active OpenSpec changes overlap]** -> Maintain a requirement-to-owner ledger; one change owns each implementation path, while this program owns cross-change acceptance.
- **[Typed migration temporarily increases code volume]** -> Require legacy subtraction in the same milestone after parity and rollback gates pass.
- **[Delegated release trust raises operational complexity]** -> Automate expiry and rotation drills, keep root recovery documented, and fail closed before launch.
- **[Real-platform laboratories are expensive or unavailable]** -> Start with disposable Linux and macOS cells, record cost, and leave unavailable platforms blocked rather than simulated as verified.
- **[Remote reconciliation could disrupt live hosts]** -> Default to discover and plan, use bounded cohorts and maintenance policies, and require host-local engine approval for mutation.
- **[Telemetry leaks sensitive context]** -> Minimize at source, scrub inherited environments, use bounded schemas, and run adversarial leak fixtures before export.
- **[Secret migration locks out recovery]** -> Preserve historical material until enrollment, rotation, rebuild, denied-access, and offline-recovery drills pass.
- **[Automated backup policy destroys dependencies]** -> Separate writer and maintenance authority and test holds, bookmarks, clones, common snapshots, and resume tokens before pruning.
- **[UI schedule blocks backend value]** -> Continue protocols, APIs, TUI, accessibility, and status truth while keeping unapproved visual tasks explicitly blocked.

## Migration Plan

1. **Program baseline:** create the cross-change ownership and evidence ledger; inventory existing contracts, deployed state, authorities, and platform claims; freeze new competing writers.
2. **Trust foundation:** establish protected release identities and environments, delegated metadata, immutable artifact admission, provenance, SBOM, activation receipts, and one canary channel.
3. **First vertical slice:** activate one signed release and migrate one useful host effect through profile bootstrap, enrollment, exact approval, engine mutation, verification, status, and rollback evidence on a disposable Linux host.
4. **Engine convergence:** migrate effects in bounded cohorts by lock domain and platform; keep compatibility adapters observable; subtract each legacy writer only after unchanged reapply and interruption evidence.
5. **Identity and operations:** enroll scoped Infisical identities, OIDC publishers, Alloy collectors, SLOs, dashboards, and recovery-safe local behavior; test denial and outage paths.
6. **Platform expansion:** qualify macOS and Linux first, then WSL, Windows, Proxmox, immutable Linux, Qubes, and containers as safe fixtures become available.
7. **Protection and recovery:** deploy workload coverage maps, ZFS/file protection, independent backups, recovery packages, and isolated restore drills in canary-to-batch order.
8. **Experience and ecosystem:** ship the protocol-backed TUI and browser session; after Figma approval, implement the SaaS experience; admit signed extensions only after the core capability model is stable.

Rollback restores the prior verified configuration and release pointer where supported, stops new reconciliation, preserves journals and migration receipts, and leaves data or external effects requiring manual recovery explicitly pending. It never force-rolls storage, destroys snapshots, reuses revoked credentials, or silently reactivates a retired writer.

## Open Questions

- Which existing authorized disposable Linux host should become the first production-like canary after repository fixtures pass?
- Which currently subscribed Infisical features are available for dynamic secrets and granular project roles in this tenant?
- Which macOS virtualization provider and image licenses are already available for recurring real-host qualification?
