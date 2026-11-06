# Fleet bootstrap delta

## Purpose

Converges the public install routine on a single secure, deterministic, resumable engine whose interactive and automated experiences share the same plan, execution, evidence, and support contract.

## ADDED Requirements

### Requirement: Immutable verified bootstrap envelope

The stage-zero launcher SHALL execute only a locally staged provisioner bound to an immutable, signed, unexpired release manifest and verified artifact checksum. It SHALL bound transport, redirects, size, time, temporary state, inherited environment, and accepted origins, and SHALL fail before execution when verification cannot be completed.

#### Scenario: Tampered provisioner

- **WHEN** the downloaded provisioner differs from the digest in a valid signed manifest
- **THEN** no provisioner code executes, temporary artifacts are cleaned, and bounded redacted evidence identifies checksum failure and exact remediation

#### Scenario: Missing verification support

- **WHEN** a target cannot verify the manifest signature or signing-key identity
- **THEN** production/headless bootstrap fails closed before mutation instead of silently degrading to TLS-only trust

### Requirement: One deterministic lifecycle and renderer-neutral protocol

Bootstrap SHALL implement `discover -> validate -> plan -> approve -> apply -> verify -> record`. TUI, plain terminal, JSON/NDJSON, headless, CI, resume, status, and offline modes SHALL consume the same strict plan, task, event, journal, and receipt schemas and SHALL agree on terminal status.

#### Scenario: Renderer equivalence

- **WHEN** identical desired state and observed facts run through TUI, plain, and machine-readable modes
- **THEN** their normalized plan digest, selected task graph, and terminal task statuses are identical

#### Scenario: Renderer failure

- **WHEN** the TUI exits, blocks, or cannot render the terminal dimensions
- **THEN** bounded presentation failure does not corrupt or indefinitely block the engine, journal, cleanup, or final evidence

### Requirement: Validated dependency DAG and safe parallelism

Every operation SHALL be a typed task with stable identity, input digest, dependencies, predicates, check/apply/verify behavior, timeout, retry class, resource needs, privilege/network/consent classes, lock domains, cleanup, and configuration compensation. Planning SHALL reject invalid graphs. Execution SHALL admit ready tasks through a bounded adaptive queue and serialize overlapping mutation domains.

#### Scenario: Concurrent independent work

- **WHEN** multiple verified downloads are ready while one package-manager transaction runs
- **THEN** downloads may run up to the resource ceiling while package-manager and overlapping privileged mutations retain exclusive ownership

#### Scenario: Failed dependency

- **WHEN** a task exhausts bounded retries and fails verification
- **THEN** dependent tasks become blocked, unrelated declared-safe branches follow policy, cleanup runs, and the run cannot report success

### Requirement: Verified idempotency and content-addressed resume

Task completion SHALL depend on current verified postconditions, not marker existence. The atomic journal and plan digest SHALL bind release, desired-state revision, normalized host facts, catalog/schema versions, graph, and consents. Resume SHALL revalidate those bindings and acquire exclusive host-run ownership before skipping verified work.

#### Scenario: Unchanged reapply

- **WHEN** a verified host reruns the identical release and desired state
- **THEN** discovery and verification may run but no package, identity, schedule, service, snapshot, marker, or configuration mutation is duplicated

#### Scenario: Host changes after interruption

- **WHEN** observed facts or a prior verified postcondition changes before resume
- **THEN** the engine invalidates the affected closure and re-plans instead of blindly trusting its journal

### Requirement: Bounded configuration rollback

Before changing installer-owned configuration or service state, the engine SHALL validate the candidate and atomically preserve the previous known-good bytes, metadata, and service state. Failed verification SHALL restore that state. Explicit rollback SHALL traverse successful compensation records in reverse dependency order and SHALL NOT imply package, operating-system, external-service, network, storage, or user-data rollback.

#### Scenario: Invalid generated configuration

- **WHEN** a candidate configuration fails its native validator or post-install health check
- **THEN** the previous configuration and service state are restored atomically and the owning task remains failed with recovery evidence

### Requirement: Signed offline closure

Offline bundles SHALL be signed, content-addressed, platform-specific dependency closures containing no operational secrets. The engine SHALL verify the complete bundle before mutation, perform no hidden network fallback, and report unsatisfied capabilities as blocked.

#### Scenario: Air-gapped apply

- **WHEN** a complete valid bundle is applied with network access denied
- **THEN** all selected offline-capable tasks complete from the bundle and evidence records zero network fallback

#### Scenario: Incomplete bundle

- **WHEN** one selected artifact, signature, license, graph entry, or required offline secret class is missing or incompatible
- **THEN** validation fails before mutation with the exact unsatisfied dependency

#### Scenario: Native offline managed configuration

- **WHEN** a signed offline task binds its check, apply, and verify operations to one private candidate artifact, canonical absolute target, and safe file mode
- **THEN** the engine verifies the candidate through the bundle's open-descriptor authority, applies it through the journal-backed configuration transaction, and preserves explicit rollback evidence without granting the sandbox host-write authority

### Requirement: Host-bound offline authority

The signed closure SHALL bind the active release, immutable host identity digest, normalized host facts, desired revision, selected dependency graph, canonical absolute targets, artifact inventory, validity window, and request nonce. Execution SHALL rediscover the live identity and facts and reproduce the approved plan before mutation.

#### Scenario: Host facts or targets changed

- **WHEN** the live host identity, semantic facts, selected graph, or absolute target differs from the signed closure
- **THEN** execution fails before mutation and requires a newly collected and signed request

### Requirement: Protected offline-bundle signing authority

A dedicated non-building authority SHALL create production host-bound bundles. Its private key SHALL be unavailable to builders, publishers, CI runners, canaries, and targets. Its authority SHALL derive from a release-root-signed delegation binding namespace, key, scope, limits, validity, and revocation epoch. It SHALL independently reconstruct and validate each claim-authenticated request.

#### Scenario: Protected host-bound bundle publication

- **WHEN** an enrolled host submits a canonical bundle request through an allowed claim-bound workload identity
- **THEN** the dedicated authority independently verifies the active signed release, reproduces the plan and dependency closure, validates every exact target and immutable artifact, signs with only its delegated offline-bundle key, publishes by content address with create-if-absent semantics, and returns a signed publication receipt without disclosing any private signing key

#### Scenario: Request replay or host substitution

- **WHEN** a request nonce is reused, a host fact or absolute target changes, execution moves to a different ephemeral host, or caller-controlled input broadens the delegated release/platform/path/artifact scope
- **THEN** signing or execution fails before mutation and the operator must collect current facts and request a new bundle

### Requirement: Independently anchored offline canary evidence

Platform promotion SHALL NOT trust a canary's self-authored report as its own authority. An independent verifier SHALL validate the release-root delegation, signed bundle publication, immutable workflow identity and conclusion, CI-platform attestation, committed engine evidence, and structural network denial before accepting offline coverage.

#### Scenario: Independently anchored canary evidence

- **WHEN** a canary claims successful offline execution
- **THEN** promotion requires an independent verifier to validate the release-root delegation, signed publication receipt, immutable bundle, CI-platform attestation and workflow identity/conclusion, live-host-bound committed journal, and network-denial evidence; a caller-provided URL/checksum, local signer, or self-authored phase report is insufficient

### Requirement: Evidence-backed platform support

The release manifest SHALL classify each OS/version/architecture/environment/role/package-manager cell as `verified`, `best-effort`, or `unsupported`. `verified` SHALL require current evidence for stage zero, plan, apply, verify, unchanged reapply, interrupted resume, configuration rollback, and headless behavior. Unknown or stale cells SHALL NOT be represented as verified.

#### Scenario: Unsupported native platform

- **WHEN** the Bash endpoint runs on native Windows, FreeBSD, or an unknown unsupported cell
- **THEN** it performs no mutation and directs the operator to a separately verified entrypoint or explicit best-effort workflow

### Requirement: Truthful local-first observability and completion

Every run SHALL retain protected local plan, event, journal, redacted log, verification, provenance, resource, and terminal-receipt evidence. Optional remote export SHALL be consented, secret-free, bounded, and fail-open. Success SHALL require every selected task to be verified or inapplicable; skipped, blocked, pending, redirected, and failed states SHALL remain distinct.

#### Scenario: Telemetry outage

- **WHEN** remote telemetry exceeds its bounded timeout
- **THEN** installation continues from local evidence, records telemetry unavailability, and does not change the task result

#### Scenario: Pending reboot

- **WHEN** a task requires a reboot before its postcondition can be verified
- **THEN** the receipt reports `pending-reboot` with an exact resume command and the run does not claim complete success

### Requirement: Measured performance without weakened safety

The installer SHALL measure stage-zero latency, time-to-plan, critical path, queue utilization, cold/warm task latency, lock contention, and peak CPU/memory/I/O/network against versioned budgets per verified fixture. Optimization SHALL NOT bypass provenance, validation, locks, consent, cleanup, or verification.

#### Scenario: Higher concurrency harms the host

- **WHEN** resource, power, thermal, metered-network, or lock signals cross a configured threshold
- **THEN** admission reduces concurrency while preserving deterministic dependencies and records the adjustment in evidence
