# Tasks

## 1. Program ownership and evidence baseline

- [x] 1.1 Create a machine-readable I01-I50 requirement-to-capability-to-owner-to-change-to-file-to-test-to-host ledger; verify every initiative has exactly one implementation owner and no conflicting active writer.
- [x] 1.2 Inventory current release, mutation, identity, secret, desired-state, telemetry, backup, UI, and platform-evidence authorities; verify observed state is stored separately from desired state and ambiguous authorities fail the baseline.
- [x] 1.3 Add program admission checks for Figma approval, authorized canary inventory, subscribed Infisical features, virtualization availability, paid-service changes, production mutations, and destructive operations; verify absent authority records `BLOCKED` without stopping unrelated work.
- [x] 1.4 Map existing active OpenSpec tasks into this program without copying their implementations; verify each overlapping task links to one upstream owner and its evidence freshness.
- [x] 1.5 Add a critical-path and work-in-progress report for the five program horizons; verify blocked dependencies and independently ready tasks are distinguishable.
- [x] 1.6 Document program operation and evidence states in `docs/desktop-tools/`; verify documentation tests reject claims that planning or contracts equal shipped capability.

## 2. Delegated release trust and publication

- [x] 2.1 Define strict delegated root, targets, platform, channel, snapshot, timestamp, build, publish, activate, monitor, and revocation metadata schemas; verify threshold, expiry, rollback, freeze, and substitution fixtures fail closed.
- [x] 2.2 Implement offline-rooted key rotation and emergency revocation ceremonies with overlap and recovery instructions; verify a disposable old-key/new-key/revoked-key drill without exposing private material.
- [x] 2.3 Implement immutable third-party artifact admission with signature/checksum, bounded transport, license, mirror, and provenance evidence; verify mutable-reference and changed-byte fixtures become new candidates rather than replacements.
- [x] 2.4 Generate SPDX 3 software and applicable AI/data inventories plus separate versioned exploitability statements for every release closure; verify schema validity and exact digest linkage.
- [x] 2.5 Add isolated hosted build provenance and GitHub artifact attestations for release artifacts; verify publication rejects an unapproved workflow, builder, commit, or subject digest.
- [x] 2.6 Add reproducibility comparison for the installer engine, privileged broker, runtime, and launchers where supported; verify unexplained output divergence blocks release admission.
- [x] 2.7 Replace long-lived CI publication credentials with claim-bound OIDC or record a provider-specific blocker; verify subject, audience, repository, workflow, environment, and ref substitution are denied.
- [x] 2.8 Implement canary/cohort activation, compare-and-swap pointers, health gates, promotion suspension, rollback, and signed receipts; verify failed canary evidence cannot advance another cohort.
- [ ] 2.9 Provision protected production release environments and scoped identities only after admission checks pass; verify signer material is absent from builders, publishers, logs, artifacts, and targets.

## 3. Installer-engine authority and transactions

- [x] 3.1 Extend shared schemas for typed operations, resources, locks, retry classes, cancellation, postconditions, receipts, and evidence gaps; verify unknown versions and fields fail at every runtime boundary.
- [x] 3.2 Implement capability, consent, dependency, and cycle validation for the operation DAG; verify invalid graphs create no journal or mutation.
- [x] 3.3 Implement the adaptive bounded ready queue with CPU, memory, disk, network, and I/O budgets; verify unrelated work progresses while exclusive domains serialize.
- [x] 3.4 Implement signal-safe cancellation and bounded child cleanup; verify cancellation at each spawn and mutation boundary produces exact terminal evidence.
- [x] 3.5 Complete content-addressed journaling, single-owner leases, stale-owner handling, and exact resume admission; verify exhaustive interruption fixtures never allow fresh-run adoption.
- [x] 3.6 Generalize atomic configuration activation with parent-path defenses, validation, metadata preservation, durable compensation, and concurrent-change detection; verify rollback restores exact supported state or stops ambiguous.
- [x] 3.7 Implement reverse-dependency configuration rollback plans and separate approval; verify package, OS, network, storage, and external effects remain explicitly non-automatic.
- [x] 3.8 Complete signed offline bundle create, inspect, verify, materialize, execute, resume, revoke, and expire operations; verify execution succeeds under network denial and rejects surplus or wrong-host material.
- [x] 3.9 Migrate one additional useful low-risk package/configuration effect from legacy provisioning through the complete engine lifecycle; verify fresh, unchanged, interrupted, resumed, rolled-back, and legacy-subtracted cases.
- [x] 3.10 Publish the effect-migration template and parity harness; verify a new migration cannot omit preconditions, postconditions, locks, interruption tests, rollback limits, or legacy subtraction.

## 4. First production-complete Desktop Tools lifecycle

- [ ] 4.1 Complete protected signer and release-channel prerequisites from `establish-desktop-tools-bootstrap`; verify the production-readiness audit reports signer and release checks passing without changing unrelated blockers.
- [ ] 4.2 Activate one immutable canary release and verify current, expired, revoked, tampered, wrong-product, and rollback attempts through independent inspection.
- [ ] 4.3 Serve a real profile descriptor and signed stage zero at an authorized canary subdomain; verify unknown profiles and unavailable channels fail closed before code execution.
- [ ] 4.4 Complete browser-first owner authentication and target enrollment with exact profile, device, scope, expiry, and one-time claim binding; verify phishing, replay, cross-tenant, and stale-profile denial.
- [ ] 4.5 Bind profile, facts, release, policy, operation closure, approvals, and rollback limits into one reviewed plan; verify safety-relevant fact drift invalidates it.
- [ ] 4.6 Execute the migrated engine effect on a disposable authorized Linux canary; verify terminal receipt binds profile, release, plan, journal, postconditions, and independent support evidence.
- [ ] 4.7 Reapply unchanged desired state and restart the target; verify no duplicate configuration, identity, schedule, service, snapshot, or mutation and confirm restart-surviving status.
- [ ] 4.8 Exercise denial, cancellation, interruption, resume, configuration rollback, revocation, and deprovision preview on the canary; verify each state is visible and no unowned data is deleted.
- [ ] 4.9 Update public capability status from deployment evidence; verify no surface labels contract-only or stale behavior as shipped.

## 5. Identity, secrets, and authorization

- [x] 5.1 Define strict host, service, CI, platform, agent, maintenance, and recovery identity manifests; verify shared identities, runtime scope overrides, recursive exports, and hidden inherited grants are rejected.
- [ ] 5.2 Discover subscribed Infisical features and record supported mechanisms without buying or enabling new service tiers; verify unsupported dynamic or granular features yield an explicit design-compatible fallback blocker.
- [ ] 5.3 Implement scoped Infisical enrollment, renewal, rotation, revocation, rebuild recovery, and secure runtime delivery for one canary service; verify allowed reads and denied cross-host, cross-environment, administrative, and recovery-root access.
- [ ] 5.4 Extend `get-secret` and workload launchers so operational access is Infisical-authoritative with no controller-store fallback; verify outage and caller-selected path tests fail closed.
- [ ] 5.5 Create the offline-secret exception schema and inventory existing local material; verify only declared pre-network, boot, offline, or independent-recovery items remain eligible.
- [ ] 5.6 Implement dual-phase rotation for one supported credential class; verify both consumer reload and rollback before retiring the historical value.
- [ ] 5.7 Add passkey/WebAuthn owner authentication and privileged step-up with recovery and revocation; verify origin, actor, challenge, target, plan, scope, and reauthentication binding.
- [ ] 5.8 Add effective-authorization simulation across product, Cloudflare, Infisical, OpenCode, and host privilege policies; verify explanations identify every contributing grant and denial.
- [ ] 5.9 Compile task-specific OpenCode permission and policy sandboxes with bounded steps, costs, tools, paths, network, skills, subagents, and secrets; verify auto mode cannot override a deny.
- [ ] 5.10 Exercise host revocation and rebuild without discarding historical recovery keys; verify operational access remains revoked and retained backup recovery still works.

## 6. Platform laboratory and evidence matrix

- [x] 6.1 Define signed support-cell, fixture, canary, benchmark, and qualification receipt schemas; verify code, policy, recipe, release, and freshness changes invalidate only affected cells.
- [ ] 6.2 Build hermetic Linux fixtures for supported Debian/Ubuntu, Fedora, Alpine, Arch, immutable-OS, container, and WSL semantics; verify clean install and unchanged reapply locally or record platform-specific infrastructure blockers.
- [ ] 6.3 Establish an authorized macOS virtualization fixture using already available licensing and infrastructure; verify headless bootstrap, restart, rollback, and GUI-gated behavior without mutating the daily workstation.
- [ ] 6.4 Add Windows-native fixture contracts for PowerShell stage zero, package providers, ACLs, reparse points, registry, services, reboot, WSL, and secret storage; verify unsupported mutation remains preflight-denied until real evidence exists.
- [ ] 6.5 Add Proxmox fixture coverage for repositories, ZFS, VM/LXC inventory, guest agents, backup, network intent, upgrade, and maintenance behavior; verify no generic role invents production ingress.
- [ ] 6.6 Add Qubes fixtures for dom0, TemplateVM, AppVM, DisposableVM, Whonix, and qrexec boundaries; verify one compartment cannot broaden another's authority.
- [ ] 6.7 Implement fault injection for process loss, reboot, ENOSPC, DNS, corrupt artifacts, expired credentials, lock loss, clock skew, permission drift, and telemetry failure; verify exact uncertain and recoverable outcomes.
- [ ] 6.8 Add versioned performance benchmarks and budgets for bootstrap, plan, critical path, queue, cold/warm lazy load, and resources; verify unsafe optimizations cannot pass on speed alone.
- [ ] 6.9 Promote the first Linux and macOS support cells only from independently attested current lifecycle receipts; verify documentation and APIs downgrade expired evidence automatically.

## 7. Fleet reconciliation, hardware, reboot, and cost control

- [x] 7.1 Implement per-host durable reconciliation state and leases with discover, validate, plan, approve, apply, verify, status, pause, resume, and stop; verify concurrent reconcilers cannot own one host.
- [ ] 7.2 Add mobile-host power, connectivity, and metered-network policies with bounded catch-up; verify missed work is prioritized rather than replayed unboundedly.
- [ ] 7.3 Add resource pressure and workload usability guards for provisioning, verification, replication, scrubs, and pruning; verify foreground services remain within declared budgets.
- [ ] 7.4 Implement hardware and firmware inventory for CPU, memory, disk identity, SMART/NVMe, GPU, firmware, Secure Boot, TPM, battery, thermal, and UPS signals; verify simulated device faults identify exact host and device.
- [ ] 7.5 Implement planned reboot coordination with active-user/workload checks, restart-safe continuation, post-boot identity, and recovery timeout; verify a missing return heartbeat never becomes success.
- [ ] 7.6 Implement staged drift repair with intentional exceptions, cohorts, stop-on-dependent-failure, and configuration rollback; verify new access and destructive repair always remain outside automatic authorization.
- [ ] 7.7 Add capacity and cost forecasts for disk, snapshots, replication, backups, egress, API operations, telemetry, models, and restores; verify thresholds gate sustained work before exhaustion.
- [ ] 7.8 Define fleet reconciliation SLOs and error budgets; verify exhausted budgets pause dependent rollout and clear only after measured recovery.

## 8. Unified observability and operations observatory

- [ ] 8.1 Define OpenTelemetry-compatible semantic conventions for hosts, profiles, releases, runs, agents, tasks, locks, approvals, effects, costs, verification, backup, and recovery; verify bounded-cardinality and schema tests.
- [ ] 8.2 Instrument control plane, runtime, installer engine, privileged broker, and reconciliation with correlated secret-safe logs, metrics, traces, and events; verify adversarial credentials and PII never leave source boundaries.
- [ ] 8.3 Deploy Alloy to one disposable canary with a recovery-safe local pipeline and validated remote modules; verify invalid remote configuration retains the last valid effective pipeline.
- [ ] 8.4 Implement bounded buffering, retry, deduplication, timestamp handling, restart survival, and delivery heartbeats; verify a running collector without queryable test evidence remains unverified.
- [ ] 8.5 Build dashboards for release adoption, fleet drift, run critical path, agent cost, secret access, platform evidence, capacity, pool health, backup freshness, replication lag, verification, and restores; verify every nonterminal state renders distinctly.
- [ ] 8.6 Add actionable deduplicated alerts with host, workload/device, recovery impact, evidence, runbook, missing-heartbeat detection, and recovery clearing; verify simulated fault-to-alert-to-clear flow.
- [ ] 8.7 Add consented fail-open telemetry export and retention controls; verify outage never blocks safe local operation or grants mutation authority.
- [ ] 8.8 Measure SLOs and error budgets from correlated evidence; verify staged rollout consumes and reacts to the correct budget.

## 9. Data protection, ZFS, backup, and disaster recovery

- [ ] 9.1 Complete per-host capability inventory and authoritative-data coverage maps for datasets, files, databases, VMs, containers, configurations, and keys; verify new unprotected sources fail coverage health.
- [ ] 9.2 Implement policy validation and discover/plan/status for Sanoid, scrubs, autosnap ownership, exclusions, schedule collision, retention dependencies, and capacity; verify read-only plans on disposable pools.
- [ ] 9.3 Implement Syncoid destination admission, restricted identity, raw encrypted history, resume, bookmarks, holds, common anchors, bandwidth, retries, and divergence handling; verify no automatic rollback or destructive target deletion.
- [ ] 9.4 Integrate existing suitable PBS, restic, rclone transport, and database-native backup paths without replacing functioning protection; verify source identity, mount presence, encryption, and false-success denial.
- [ ] 9.5 Implement separate writer and maintenance identities with provider-supported limits; verify the writer cannot prune and document where a provider cannot guarantee immutability.
- [ ] 9.6 Build the encrypted independent recovery package and key catalog with an offline exception record; verify the recovery password unlocks every retained covered key type in a separate trusted environment without Infisical.
- [ ] 9.7 Schedule structural, rotating content, full, and client-decryption checks with coverage accounting; verify server-side chunk checks cannot satisfy restore readiness alone.
- [ ] 9.8 Run isolated representative file, database, service, VM/container, and source-unavailable restores; verify content and application behavior without overwriting or activating production.
- [ ] 9.9 Exercise controller, DNS, Infisical, source-host, and primary-pool failure recovery; verify the documented minimum bootstrap does not require the failed dependency to restore itself.
- [ ] 9.10 Complete Zen read-only diagnosis and safe preparation through the existing recovery change; perform irreversible repair only with verified device identity, hardware, backup, and maintenance authority, and verify completed resilver/scrub before claiming repair.

## 10. Catalog, supply chain, and extension ecosystem

- [ ] 10.1 Replace permissive catalog parsing with a strict versioned schema covering identity, lifecycle, dependencies, conflicts, load, privilege, exposure, provenance, license, and support evidence; verify all entries migrate deterministically.
- [ ] 10.2 Build the catalog dependency and supported-path graph with cycle, conflict, platform, architecture, role, eager/lazy, and bootstrap validation; verify plans explain every inclusion and exclusion.
- [ ] 10.3 Implement immutable GitHub and other upstream release resolution through the artifact admission service; verify architecture selection, extraction, install, update, uninstall, and offline reuse with hermetic fixtures.
- [ ] 10.4 Add continuous upstream freshness, maintenance, popularity, vulnerability, license, and support-evidence audit without making network results a provisioning dependency; verify unknown remote evidence remains explicit.
- [ ] 10.5 Generate release SBOM/VEX and catalog provenance views in the control plane; verify user-visible claims match exact release bytes and current exploitability evidence.
- [ ] 10.6 Define signed extension manifests, compatibility, capabilities, lifecycle hooks, isolated tests, publication, private catalogs, and revocation; verify arbitrary npm auto-install cannot enter the privileged runtime.
- [ ] 10.7 Admit one low-risk read-only extension end to end; verify signature, provenance, permission denial, version compatibility, disablement, and revocation.
- [ ] 10.8 Retire duplicate catalog generators and legacy recipe authorities only after parity; verify one canonical source regenerates every derived catalog byte-for-byte.

## 11. Desktop Tools runtime, sessions, and renderers

- [ ] 11.1 Integrate the pinned OpenCode SDK behind a replaceable Desktop Tools host interface with owned lifecycle and no public listener; verify deterministic startup, shutdown, upgrade compatibility, and private binding.
- [ ] 11.2 Generate task-specific agents, prompts, tools, skills, model policy, context limits, recordings, and budgets from the approved plan; verify inherited ambient authority is absent.
- [ ] 11.3 Implement durable per-session coordination and resumable WebSocket transport with acknowledgement, backpressure, replay, resize, expiry, and cancellation; verify reconnect does not create another run.
- [ ] 11.4 Complete encrypted output-only recordings for local, browser, scheduled, child, and offline sessions; verify raw input and secrets never enter recordings and incomplete capture is visible.
- [ ] 11.5 Stabilize the renderer-neutral event protocol and terminal outcome mapping across TUI, plain, JSON, NDJSON, headless, and CI; verify golden parity fixtures.
- [ ] 11.6 Implement the multi-agent TUI with attributable streams, DAG, critical path, locks, retries, approvals, costs, verification, detach/follow, narrow/resize, keyboard, screen-reader, `NO_COLOR`, and reduced-motion behavior; verify PTY restoration after crashes and signals.
- [ ] 11.7 Implement deterministic profile compilation, semantic diff, migration, conflict explanation, import/export, and simulation without secret values; verify repeated compilation is byte-identical.
- [ ] 11.8 Build nonvisual SaaS APIs and accessibility contracts for profiles, machines, plans, approvals, live runs, history, catalog, drift, secrets readiness, and recovery; verify tenant and capability truth boundaries.
- [ ] 11.9 Obtain explicit approval of the current Figma artifact before visual SaaS implementation; verify the approval reference is recorded, otherwise keep only visual tasks blocked.
- [ ] 11.10 After approval, implement and real-browser-test the SaaS experience against the shared protocol; verify WCAG, responsive behavior, security headers, performance budgets, and no direct mutation authority.

## 12. Remaining platform-native implementations

- [ ] 12.1 Implement Windows stage zero and native installer operations for package, file, registry, service, ACL, reboot, and secret boundaries; verify on an authorized disposable Windows fixture before promoting support.
- [ ] 12.2 Implement WSL host/guest identity and restart semantics without conflating Windows and Linux authority; verify cross-boundary path and credential denial.
- [ ] 12.3 Implement immutable Linux deployment planning, layering, Flatpak, reboot, status, and rollback semantics; verify on a disposable OSTree fixture.
- [ ] 12.4 Implement Proxmox lifecycle operations for repositories, host configuration, VM/LXC metadata, guests, backup, network intent, upgrades, and maintenance; verify on a disposable or explicitly authorized canary.
- [ ] 12.5 Implement Qubes-native qrexec-mediated dom0, template, app, disposable, and Whonix operations; verify compartment isolation and offline execution.
- [ ] 12.6 Implement hardware-backed device keys and posture evidence where supported with explicit degraded assurance elsewhere; verify unsupported hardware never receives equivalent attestation status.
- [ ] 12.7 Implement UPS-aware dependency shutdown and safe recovery where existing supported hardware is detected; verify only simulation unless a disruptive maintenance window is explicitly authorized.
- [ ] 12.8 Qualify each remaining platform cell through the complete lifecycle and publish only fresh independent evidence; verify unsupported cells remain blocked.

## 13. Cross-program acceptance and migration closure

- [ ] 13.1 Run schema, unit, integration, adversarial, secret, provenance, generated-artifact, renderer, offline, interruption, rollback, and platform tests within their declared budgets; verify failures remain distinct from skips, blockers, and unverified work.
- [ ] 13.2 Run a production-like browser-to-host canary from profile URL through verified receipt, restart, unchanged reapply, revocation, and recovery; verify no manual hidden mutation is required.
- [ ] 13.3 Reconcile the I01-I50 ledger against code, deployment, host, and verification evidence; verify no initiative is marked complete from planning, generated configuration, a started process, or a pending job.
- [ ] 13.4 Remove each superseded legacy writer, credential, scheduler, collector, catalog generator, release path, and compatibility shim only after its successor's parity and rollback gate; verify rollback targets remain available for the documented window.
- [ ] 13.5 Update durable specs and operator, install, repair, offline, security, recovery, extension, and platform documentation from verified behavior; verify commands run as written on applicable fixtures.
- [ ] 13.6 Run two fresh repository convergence passes, strict OpenSpec validation, repository-wide tests, and independent security review; verify no new higher-priority unowned issue remains.

## Workflow follow-up

- Sync completed delta specifications only after implementation evidence satisfies their requirements.
- Archive this change only when every tracked task is complete or a successor change explicitly owns and links the remaining work.
