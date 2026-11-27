# Tasks

## 1. Value-free inventory and disposition

- [x] 1.1 Implement deterministic discovery and planning from secret names, repository evidence, host roles, and value-free Infisical bindings.
- [ ] 1.2 Produce a complete name-only inventory of encrypted chezmoi sources and map every name to `operational-migrate`, `offline-exception`, `blocked-unknown`, or `retirement-candidate` with owner and consumer evidence.
- [ ] 1.3 Canonicalize aliases and duplicates; fail planning on conflicting owner, environment, source, or destination metadata.
- [ ] 1.4 Verify discovery never decrypts values, reads rendered secret targets, dumps secret-bearing environments, or writes durable value fingerprints.
- [ ] 1.5 Fix source precedence so only `macos.megabyte.space` applies `secrets-workstation` overrides; Ubuntu and other hosts use the general inventory by default.
- [ ] 1.6 Implement `--secret-directory` as a normalized, approved-root, non-persistent override for exactly one explicitly selected host; reject multi-host, missing, ambiguous, overlapping, and symlink-escaping inputs.

## 2. Host-profile hardening

- [x] 2.1 Replace broad role bundles with deny-by-default host-class isolation bound to independently enrolled identities. Evidence: separate macOS and Ubuntu projects; each identity has organization No Access and Viewer only in its assigned project.
- [ ] 2.1a Require every managed host declaration to contain a non-empty exact `projectId` and absolute `secretPath`; reject missing, mismatched, duplicate, or undeclared routing pairs.
- [ ] 2.1b Declare dedicated macOS/Ubuntu hosts against their isolated project root and enumerate legacy managed workstations that temporarily retain exact Global-project host paths with owner and retirement status.
- [ ] 2.2 Harden the macOS developer-workstation profile to exclude recovery roots, personal credentials, unrelated production administration, signing roots, and destructive infrastructure credentials unless individually evidenced and approved.
- [ ] 2.3 Harden Ubuntu server/runner profiles to service-specific non-interactive grants with no inherited developer-personal bundle.
- [ ] 2.3a Classify raw AI upstream/provider keys as Ubuntu/LiteLLM-runtime-only and scoped LiteLLM client keys as the only AI access granted to macOS.
- [ ] 2.4 Add negative tests for unknown, cloned, renamed, stale, role-conflicting, expired, oversized, and implicitly expanded host profiles.
- [ ] 2.5 Add deterministic profile-diff, downgrade, revocation, and re-enrollment tests without resolving secret values.

## 2A. Workload targets

- [ ] 2A.1 Add manifest target `workloads.mcp.megabyte.space` with project ID `4ae065b0-c081-454e-a513-220a28e5d2f0`, `secretPath: /`, workload identity/policy references, and no credential values.
- [ ] 2A.2 Implement `--workload` as an explicit single-target selector mutually exclusive with `--host`; reject both/neither where required, multiple targets, unknown targets, and cross-target override reuse before inventory access.
- [ ] 2A.3 Make every workload use the general encrypted inventory only and prove `secrets-workstation`, cwd, home state, executing host, and ambient Infisical configuration cannot alter source selection.
- [ ] 2A.4 Classify Cloudflare-native MCP provider credentials as `mcp.megabyte.space` workload-only and reject them from macOS, Ubuntu/LiteLLM, legacy workstation, CI, and human profiles absent a separate explicit consumer contract.

## 3. Safe migration engine

- [x] 3.1 Implement masked, in-memory Infisical apply operations for explicitly selected names.
- [ ] 3.2 Enforce the per-secret migration state machine and bind every transition to an exact reviewed plan digest.
- [ ] 3.3 Add concurrency locking and fail-closed destination-conflict handling; require separately admitted overwrite without exposing either value.
- [ ] 3.4 Prove selected values travel memory-only to the exact Infisical project/environment/path and never enter disk staging, argv, logs, receipts, history, telemetry, or Markdown.
- [ ] 3.5 Keep deletion, rotation, revocation, permission widening, encrypted-source removal, and age-key retirement outside apply authority.
- [ ] 3.6 Implement a durable metadata-only validation ledger with canonical name/source/destination bindings, `valid`/`unverified`/`invalid-retired` status, validator provenance, scope, freshness, and evidence references but no values or fingerprints.
- [ ] 3.7 Add an all-selected-credentials preflight and locked pre-write gate: only fresh matching `valid` records proceed; any missing, unverified, invalid-retired, stale, mismatched, or untrusted record aborts before decryption and before the first write.
- [ ] 3.8 Bind the exact ledger-record evidence digest into the reviewed plan and invalidate apply on ledger, selection, destination, or freshness drift.
- [ ] 3.9 Emit value-free migrated-destination evidence with exact project/environment/path, safe destination version metadata, writer identity, plan digest, and authorized-read/unauthorized-denial results.
- [ ] 3.10 Apply the same validation-ledger and locked pre-write gate to workloads, binding evidence to workload ID, general-inventory source, exact project/root path, consumer, environment, and plan; reject host/workload ledger substitution.
- [ ] 3.11 Add the workload round-trip gate: production-equivalent workload retrieval, bounded non-destructive consumer use, and representative host/cross-project denial before cutover or retirement evidence.

## 4. Identity and destination reconciliation

- [x] 4.1 Reconcile Infisical projects, environments, root secret paths, and independently revocable host identities from the reviewed plan. Evidence: separate macOS/Ubuntu projects with assigned project Viewer roles and organization No Access.
- [ ] 4.1a Pass the selected host declaration's `projectId` and `secretPath` explicitly to every inventory, read, write, verify, and rollback operation; verify returned project context before accepting results.
- [ ] 4.1b Make `--project-id` a non-persistent, single-explicit-host override that cannot select multiple hosts, supply implicit paths, enroll unknown hosts, or mutate desired state.
- [ ] 4.1c Reject project selection inherited from cwd, repository or home `.infisical.json`, home configuration, environment defaults, or remembered Infisical CLI state.
- [ ] 4.2 Reconcile repository-and-environment-bound GitHub OIDC identities without copying host credentials into CI.
- [ ] 4.3 Separate host, CI, release, backup/recovery, and human identities and verify cross-identity denial. PARTIAL: macOS-to-Ubuntu and Ubuntu-to-macOS reads return `403`; non-host identity classes remain pending.
- [x] 4.4 Record the implemented host authentication lifecycle without credential material: Universal Auth access tokens use 900-second TTL and maximum two uses; client secrets use 90-day expiry and platform-specific protected storage.
- [x] 4.5 Store the macOS client secret in macOS Keychain and the Ubuntu client secret in a mode-`0600` protected file; verify neither appears in repository, rendered configuration, argv, or logs.

## 5. Consumer cutover and bounded fallback

- [ ] 5.1 Make online consumers prefer their exact Infisical path and permit age fallback only for manifest-declared transition or offline exceptions.
- [x] 5.2 Canary one capability group on macOS and one on Ubuntu through authorized retrieval and unauthorized denial without printing values. Evidence: each identity read its allowed root secret path and cross-project reads returned `403`; real-consumer breadth beyond the canary remains governed by later rollout tasks.
- [ ] 5.3 Execute Infisical outage, expired/revoked identity, replacement-host, profile-downgrade, and rollback drills for both host classes.
- [ ] 5.4 Verify normal online operation cannot fall back to the full chezmoi inventory and unknown names fail closed.

## 6. Recovery and retirement gates

- [ ] 6.1 Validate every offline exception has owner, consumer, reason, review date, minimum scope, and executed recovery evidence.
- [ ] 6.2 Demonstrate independent recovery using only the declared exception set; do not delete or modify source material during the drill.
- [ ] 6.3 Produce a value-free retirement-eligibility report after the observation window, with exact remaining blockers per secret. PARTIAL: one exact canary completed source retirement after allowed-read and cross-project `403` evidence; bulk eligibility remains pending.
- [ ] 6.4 Preserve all non-canary encrypted templates, age identities, and credentials; propose any additional deletion, rotation, or revocation as a later separately approved destructive change.
- [ ] 6.5 Record source-retirement assertions that bind exact source, canonical name, `valid` or `invalid-retired` provenance as applicable, migrated-destination evidence, consumer cutover, observation window, recovery state, approval, and timestamp.
- [ ] 6.6 Reject retirement assertions with missing/mismatched destination evidence and prove a canary assertion cannot authorize another source.

## 7. Verification and documentation

- [x] 7.1 Preserve existing deterministic planner and secret-safety test coverage as the migration foundation.
- [ ] 7.2 Add adversarial tests for value leakage, broad grants, alias collision, stale identity, destination conflict, partial failure, retry, outage, and rollback.
- [ ] 7.2a Add routing tests for missing/wrong project IDs, missing/wrong paths, dedicated-root isolation, declared legacy Global paths, multi-host override rejection, cwd/home ambient-state poisoning, and cross-project `403`.
- [ ] 7.2b Add acceptance tests for macOS workstation override precedence, Ubuntu/general precedence despite collisions, other-host exclusion, safe single-host directory override, unsafe override rejection, Ubuntu upstream-key access, macOS upstream-key denial, and macOS LiteLLM-client-only access.
- [ ] 7.2c Add acceptance tests for complete valid admission, missing/unverified/invalid-retired/stale/wrong-scope rejection before write, atomic batch abort, ledger race invalidation, metadata-only destination receipts, and exact-source retirement assertions.
- [ ] 7.2d Add workload acceptance tests for MCP manifest routing, host/workload exclusivity, unknown/multiple target rejection, general-inventory-only selection, workstation collision exclusion, ledger target binding, workload-only Cloudflare provider placement, production-equivalent round trip, and host/cross-project `403`.
- [ ] 7.3 Update operator documentation to distinguish online authority, transition fallback, offline recovery, and retirement eligibility without listing values.
- [ ] 7.4 Run strict OpenSpec validation and focused repository secret-safety/profile tests; report PASS, FAIL, BLOCKED, and UNVERIFIED distinctly.
