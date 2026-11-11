# Proposal

**Architect:** codex
**Architect Role:** assigned

## Why

Desktop Tools has strong isolated contracts, tests, and legacy provisioning coverage, but it does not yet provide one production-verified browser-to-host lifecycle or a current evidence-backed support claim for any complete platform. The approved 50-initiative program converts those foundations into a trustworthy product by sequencing release authority, typed execution, real-host verification, identity, recovery, observability, and user experience behind explicit evidence gates.

## What Changes

- Deliver one complete `https://<profile>.desktop.tools | bash` lifecycle from signed stage zero through enrollment, planning, approved mutation, verification, recovery evidence, and durable status.
- Make the installer engine the sole authority for selected host mutations through typed DAG operations, transactional configuration, interruption recovery, offline bundles, and renderer-neutral events.
- Establish delegated release trust, hardened reproducible builds, provenance, SBOM/VEX, immutable artifact ingestion, staged promotion, revocation, and rollback.
- Add durable per-host reconciliation, browser terminal sessions, platform laboratories, evidence-backed support cells, fault injection, performance budgets, and controlled reboot handling.
- Establish least-privilege human, workload, machine, agent, secret, approval, and posture authority with explicit offline exceptions and independently tested denial paths.
- Provide fleet observability, backup/replication/recovery orchestration, disaster-recovery drills, capacity/cost controls, and truthful operational SLOs.
- Build the Desktop Tools web, terminal, profile-customization, extension, and OpenCode-derived experiences over the same typed contracts; visual SaaS implementation remains blocked until its Figma artifact is approved.
- **BREAKING** Retire legacy mutation, release, telemetry, secret, and UI authorities only after their typed successors pass parity, migration, rollback, and real-host verification gates. Compatibility shims remain bounded and explicitly observable during migration.

## Capabilities

### New Capabilities

- `desktop-tools-product-lifecycle`: End-to-end profile bootstrap, enrollment, authenticated planning, execution, live session, status, and recovery behavior.
- `installer-transaction-engine`: Typed DAG execution, lock domains, journals, configuration transactions, resume, rollback, offline bundles, and renderer-neutral events.
- `release-trust`: Delegated release authority, reproducible builds, attestations, artifact ingestion, promotion, expiry, revocation, and rollback.
- `fleet-reconciliation`: Durable host desired-state reconciliation, drift, maintenance windows, reboot coordination, capacity policy, and safe rollout.
- `platform-verification`: Real-platform laboratories, capability evidence, support-cell promotion, fault injection, and performance qualification.
- `identity-secret-authority`: Human, workload, machine, agent, approval, secret, offline-recovery, and posture authorization boundaries.
- `fleet-observability`: Shared telemetry semantics, Alloy delivery, SLOs, dashboards, alerts, audit evidence, and cost attribution.
- `data-protection-recovery`: ZFS and file-level protection, backup, replication, verification, restore drills, and dependency-failure recovery.
- `software-supply-chain`: Strict catalog recipes, dependency closure, upstream provenance, SBOM/VEX, policy, lifecycle, and extension admission.
- `desktop-tools-experience`: Web, TUI, browser-terminal, profile studio, OpenCode derivative, accessibility, and signed extension experience.

### Modified Capabilities

- `fleet-bootstrap`: Strengthen bootstrap from a bounded planned launcher to a signed, transactional, resumable, offline-capable and evidence-qualified lifecycle.
- `default-provisioning-policy`: Make automatic selection depend on strict catalog closure, host capability, load policy, risk, consent, and verified support evidence.
- `software-curation`: Require immutable provenance, lifecycle semantics, dependency closure, security evidence, and policy-qualified admission for every executable recipe.
- `agent-throughput`: Require task-scoped agent sandboxes, attributable swarm execution, budgets, and authority-preserving delegation while retaining frontier architecture and verification ownership.

## Impact

The program affects `packages/aid-core`, `packages/installer-engine`, `packages/privileged-broker`, `packages/desktop-tools-runtime`, `packages/control-plane`, `software.yml`, stage-zero and provisioning scripts, chezmoi desired state, fleet services, secrets and recovery tooling, observability configuration, release workflows, tests, documentation, and the retired-site migration boundary. It introduces long-lived release and identity authorities, platform test infrastructure, host canaries, and operational data migrations; no production deployment, paid-service expansion, destructive storage action, or visual SaaS implementation is implied without its separate safety or approval gate.
