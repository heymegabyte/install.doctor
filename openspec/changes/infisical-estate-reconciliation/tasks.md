# Tasks

## 1. Value-free inventory and disposition

- [x] 1.1 Implement deterministic discovery and planning from secret names, repository evidence, host roles, and value-free Infisical bindings.
- [ ] 1.2 Produce a complete name-only inventory of encrypted chezmoi sources and map every name to `operational-migrate`, `offline-exception`, `blocked-unknown`, or `retirement-candidate` with owner and consumer evidence.
- [ ] 1.3 Canonicalize aliases and duplicates; fail planning on conflicting owner, environment, source, or destination metadata.
- [ ] 1.4 Verify discovery never decrypts values, reads rendered secret targets, dumps secret-bearing environments, or writes durable value fingerprints.
- [ ] 1.5 Fix source precedence so only `macos.megabyte.space` applies `secrets-workstation` overrides; Ubuntu and other hosts use the general inventory by default.
- [ ] 1.6 Implement `--secret-directory` as a normalized, approved-root, non-persistent override for exactly one explicitly selected host; reject multi-host, missing, ambiguous, overlapping, and symlink-escaping inputs.
- [ ] 1.7 Inventory every regular encrypted entry in general, workstation, and WordPress stores with a stable store-qualified source ID, normalized path, canonical name, ciphertext drift digest, precedence/alias metadata, and no plaintext-derived fingerprint.
- [ ] 1.8 Preserve same-named sources independently; reject ambiguous collisions, duplicate source IDs, symlinks, path escapes, undeclared stores, and silent shadowing.
- [ ] 1.9 Map WordPress sources only to explicit WordPress/site workload targets and prove they cannot enter host defaults.

## 2. Host-profile hardening

- [x] 2.1 Replace broad role bundles with deny-by-default host-class isolation bound to independently enrolled identities. Evidence: separate macOS and Ubuntu projects; each identity has organization No Access and Viewer only in its assigned project.
- [ ] 2.1a Require every managed host declaration to contain a non-empty exact `projectId` and absolute `secretPath`; reject missing, mismatched, duplicate, or undeclared routing pairs.
- [ ] 2.1b Declare dedicated macOS/Ubuntu hosts against their isolated project root and enumerate legacy managed workstations that temporarily retain exact Global-project host paths with owner and retirement status.
- [ ] 2.2 Harden the macOS developer-workstation profile to exclude recovery roots, personal credentials, unrelated production administration, signing roots, and destructive infrastructure credentials unless individually evidenced and approved.
- [ ] 2.3 Harden Ubuntu server/runner profiles to service-specific non-interactive grants with no inherited developer-personal bundle.
- [ ] 2.3a Classify raw AI upstream/provider keys as Ubuntu/LiteLLM-runtime-only and scoped LiteLLM client keys as the only AI access granted to macOS.
- [ ] 2.4 Add negative tests for unknown, cloned, renamed, stale, role-conflicting, expired, oversized, and implicitly expanded host profiles.
- [ ] 2.5 Add deterministic profile-diff, downgrade, revocation, and re-enrollment tests without resolving secret values.
- [ ] 2.6 Reserve `^CF_ACCESS_SSH_.*_(CLIENT_ID|CLIENT_SECRET)$` from the generic `cloudflare`/`^CF_` capability and add an exact-name `cloudflare-access-ssh-client` capability containing only the Coolify and Ubuntu client ID/secret pairs.
- [ ] 2.7 Grant `cloudflare-access-ssh-client` only to `macos.megabyte.space`; prove Ubuntu, Zen, Legion, Omen, every workload, and every other host profile exclude all four names.
- [ ] 2.8 Add Omen to the manifest only after its exact project ID, absolute secret path, identity, profile, owner, and migration state are reviewed; until then reject Omen as an undeclared target, and never grant its eventual managed-host profile the SSH client capability.
- [ ] 2.9 Add schema/compiler support for reserved-name deny-before-allow semantics, reject ambiguous regex overlap, and require exact reviewed re-admission plus a value-free profile diff.
- [x] 2.10 Reserve the exact Teams pair from generic Cloudflare matching and add `cloudflare-warp-enrollment` only to macOS and Ubuntu, mapping workstation source to the macOS project root and general source to the Ubuntu project root.
- [x] 2.11 Record the two byte-identical Teams source identities as an explicit equivalence/override relation without collapsing their independent destinations, validation, cutover, or retirement evidence; reject general-source fallback to any other host.
- [ ] 2.12 Replace shared `Desktopbrew` with independently revocable macOS and Ubuntu WARP enrollment tokens, bind each only to its host/project and WARP Login policy, prove re-enrollment/health, then separately authorize policy removal and revocation of the century-lived shared token.
- [ ] 2.13 Make Teams-pair retrieval enrollment/recovery-only and prove healthy registered clients do not fetch it continuously or leave it in readable MDM files, argv, environment, logs, generated output, or MCP descriptors.
- [x] 2.14 Route both provider-valid `CLOUDFLARE_ORIGIN_CA_KEY` sources to the dedicated human-admin-only `cloudflare-control-plane.megabyte.space` project, prove round trip and runtime-identity denial, then retire each exact source; require a new scoped token and workload identity before any automation consumer is added.
- [ ] 2.15 Reserve general `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` from generic Cloudflare matching and add an exact `megabyte-os-e2e-access` capability only to macOS, bound to token/application/domain/runner provenance.
- [ ] 2.16 Prove the OS pair cannot enter Ubuntu, Zen, Legion, Omen, Mission/Listmonk, GitLab, project-sites, MCP automation, Portal, Worker, or generic Cloudflare plans and cannot substitute for `MCP_AUTOMATION_CF_ACCESS_CLIENT_*` or Secrets Store bindings.
- [ ] 2.17 Keep the OS pair validation `unverified`/`blocked-upstream` while `os.megabyte.space` returns `522`; after origin recovery require authenticated allowed E2E, anonymous denial, and representative unrelated-application denial before `valid`, apply, or cutover.
- [x] 2.18 Reserve `CLOUDFLARE_API_KEY`/`CLOUDFLARE_EMAIL` from generic Cloudflare matching and re-admit them only through `cloudflare-global-admin-legacy` on macOS and Ubuntu; prove managed hosts and workloads exclude the pair.
- [ ] 2.19 Rotate the browser-exposed Global API Key through Cloudflare's security-check-protected dashboard, invalidate and prove rejection of the old value, validate the replacement, update both legacy host destinations atomically, and keep new runtime use denied until those gates pass.
- [x] 2.19a Quarantine `CLOUDFLARE_API_KEY` in the standard host resolver and deploy the fail-closed resolver to both `macos.megabyte.space` and `ubuntu.megabyte.space`; prove the key is denied while a non-quarantined Infisical value still resolves on each host, and preserve operator-only rotation access outside the normal resolver.
- [ ] 2.20 Inventory every executable Global API Key consumer, replace each with a purpose-scoped token or audited human control-plane operation, verify macOS/Ubuntu behavior and direct-retrieval denial, then remove the pair from both runtime projects and retire the transitional capability.

## 2A. Workload targets

- [ ] 2A.1 Add manifest target `workloads.mcp.megabyte.space` with project ID `4ae065b0-c081-454e-a513-220a28e5d2f0`, `secretPath: /`, workload identity/policy references, and no credential values.
- [ ] 2A.2 Implement `--workload` as an explicit single-target selector mutually exclusive with `--host`; reject both/neither where required, multiple targets, unknown targets, and cross-target override reuse before inventory access.
- [ ] 2A.3 Make every workload use exactly one declared source store—general for ordinary/MCP workloads or `secrets-wordpress` for declared WordPress/site workloads—and prove `secrets-workstation`, cwd, home state, executing host, and ambient Infisical configuration cannot alter or merge source selection.
- [ ] 2A.4 Classify Cloudflare-native MCP provider credentials as `mcp.megabyte.space` workload-only and reject them from macOS, Ubuntu/LiteLLM, legacy workstation, CI, and human profiles absent a separate explicit consumer contract.
- [ ] 2A.5 Add manifest target `workloads.wordpress-platform.megabyte.space` with profile `wordpress-platform`, a reviewed dedicated Infisical project ID, root path `/`, dedicated identity/policy references, and exclusive `sourceStore: secrets-wordpress`; do not reuse Global, host, MCP, macOS, or Ubuntu projects.
- [ ] 2A.6 Define exact allowlists for all 14 WordPress source IDs by evidenced backup/storage, ingress/networking, observability, mail, SFTP bootstrap, and privileged-bootstrap consumers; keep unknown or unsupported mappings blocked.
- [ ] 2A.7 Split any source consumed by a distinct site, identity, or failure boundary into its own explicit site workload and dedicated project; prove a path in the shared project is not treated as an authorization boundary.
- [ ] 2A.8 Keep `SUDO_PASSWORD` out of the steady-state WordPress platform profile and require a separately justified bootstrap/recovery workload before admission; bound SFTPGo default-admin credentials to bootstrap where the consumer supports it.

## 3. Safe migration engine

- [x] 3.1 Implement masked, in-memory Infisical apply operations for explicitly selected names.
- [ ] 3.2 Enforce the per-secret migration state machine and bind every transition to an exact reviewed plan digest.
- [ ] 3.3 Add concurrency locking and fail-closed destination-conflict handling; require separately admitted overwrite without exposing either value.
- [ ] 3.4 Prove selected values travel memory-only to the exact Infisical project/environment/path and never enter disk staging, argv, logs, receipts, history, telemetry, or Markdown.
- [ ] 3.5 Keep deletion and encrypted-source removal outside destination-write apply authority but inside the exact-source retirement phase after all gates pass; keep rotation, revocation, permission widening, and age-key/identity retirement outside this change.
- [ ] 3.6 Implement a durable metadata-only validation ledger with canonical name/source/destination bindings, `valid`/`unverified`/`invalid-retired` status, validator provenance, scope, freshness, and evidence references but no values or fingerprints.
- [ ] 3.7 Add an all-selected-credentials preflight and locked pre-write gate: only fresh matching `valid` records proceed; any missing, unverified, invalid-retired, stale, mismatched, or untrusted record aborts before decryption and before the first write.
- [ ] 3.8 Bind the exact ledger-record evidence digest into the reviewed plan and invalidate apply on ledger, selection, destination, or freshness drift.
- [ ] 3.9 Emit value-free migrated-destination evidence with exact project/environment/path, safe destination version metadata, writer identity, plan digest, and authorized-read/unauthorized-denial results.
- [ ] 3.10 Apply the same validation-ledger and locked pre-write gate to workloads, binding evidence to workload ID, declared source-store identity, exact project/root path, consumer, environment, and plan; reject host/workload or cross-store ledger substitution.
- [ ] 3.11 Add the workload round-trip gate: production-equivalent workload retrieval, bounded non-destructive consumer use, and representative host/cross-project denial before cutover or retirement evidence.
- [ ] 3.12 Require current provider-specific validation for every selected source identity before use; keep inconclusive/unreachable/stale results `unverified` and fail before write.
- [ ] 3.13 Track an explicit required-destination set per source and mark each destination complete only after write, Infisical round trip, intended target-host/workload retrieval, cross-target denial, consumer cutover, and rollback evidence.
- [ ] 3.14 Prove writer-side verification cannot substitute for intended target retrieval and one completed destination cannot hide another incomplete destination.

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
- [ ] 6.3 Produce a value-free retirement-eligibility report after the observation window, with exact remaining blockers per source. PARTIAL: one exact canary completed source retirement after allowed-read and cross-project `403` evidence; every remaining source must independently pass all gates.
- [ ] 6.4 Delete each non-canary encrypted source once its exact-source validation, all required destination round trips and target retrieval, consumer cutover, observation/recovery, offline-exception, and retirement-assertion gates pass; preserve only sources with an incomplete gate or a current technically required offline exception.
- [x] 6.4a Migrate `general:FAL_ADMIN_API_KEY` only to the Ubuntu production project, verify normalized value equality through Ubuntu `get-secret`, execute a bounded Fal account-billing read from Ubuntu, and retire the exact ciphertext-digest-bound age source. Evidence: provider HTTP 200 with `credits` and `username` schema; retirement receipt destination `ubuntu.megabyte.space`.
- [x] 6.4b Retire `general:CARTESIA_ADMIN_API_KEY` without migration after two read-only Cartesia voices requests returned HTTP 401 and a repository/chezmoi consumer search found no executable references; bind deletion to the exact ciphertext digest with empty required destination and consumer sets.
- [ ] 6.5 Record source-retirement assertions that bind exact source, canonical name, `valid` or `invalid-retired` provenance as applicable, migrated-destination evidence, consumer cutover, observation window, recovery state, approval, and timestamp.
- [ ] 6.6 Reject retirement assertions with missing/mismatched destination evidence and prove a canary assertion cannot authorize another source.
- [ ] 6.7 Delete an encrypted source only through an exact drift-bound retirement assertion after every required destination and consumer is complete, the observation/fallback window closes, rollback exists, and no offline exception remains active.
- [ ] 6.8 Implement invalid retirement only for provider-confirmed invalid exact sources with empty required-destination/consumer sets; prove it cannot authorize migration, fallback, or deletion of same-named sources.
- [ ] 6.9 Bind offline exceptions to exact source IDs, prove current technical necessity and minimum scope, test their recovery path, and report them separately; retire stale, convenience-only, or superseded exceptions so only a still-required exception blocks deletion.

## 7. Verification and documentation

- [x] 7.1 Preserve existing deterministic planner and secret-safety test coverage as the migration foundation.
- [ ] 7.2 Add adversarial tests for value leakage, broad grants, alias collision, stale identity, destination conflict, partial failure, retry, outage, and rollback.
- [ ] 7.2a Add routing tests for missing/wrong project IDs, missing/wrong paths, dedicated-root isolation, declared legacy Global paths, multi-host override rejection, cwd/home ambient-state poisoning, and cross-project `403`.
- [ ] 7.2b Add acceptance tests for macOS workstation override precedence, Ubuntu/general precedence despite collisions, other-host exclusion, safe single-host directory override, unsafe override rejection, Ubuntu upstream-key access, macOS upstream-key denial, and macOS LiteLLM-client-only access.
- [ ] 7.2c Add acceptance tests for complete valid admission, missing/unverified/invalid-retired/stale/wrong-scope rejection before write, atomic batch abort, ledger race invalidation, metadata-only destination receipts, and exact-source retirement assertions.
- [ ] 7.2d Add workload acceptance tests for MCP manifest routing, host/workload exclusivity, unknown/multiple target rejection, general-inventory-only selection, workstation collision exclusion, ledger target binding, workload-only Cloudflare provider placement, production-equivalent round trip, and host/cross-project `403`.
- [ ] 7.2e Add acceptance tests for three-store source identity, same-name independence, provider validation, invalid retirement, multi-destination completeness, target-host retrieval, active offline exceptions, exact-source deletion, and profile/listing drift.
- [ ] 7.2f Add a deterministic metadata-only listing and closed-set sync validator across inventory, profiles, host/workload targets, validation ledger, destination evidence, offline exceptions, and retirement assertions.
- [ ] 7.2g Add WordPress workload tests for exact 14-source inventory, exclusive source-store selection, host/general/workstation/MCP exclusion, dedicated-project routing, per-group allowlists, site-project split, privileged-bootstrap denial, intended workload retrieval, and explicit cross-target denial.
- [ ] 7.2h Add SSH Access credential tests for macOS exact-name admission, Coolify/Ubuntu pair completeness, Ubuntu/Zen/Legion/Omen denial, generic `^CF_` exclusion, undeclared-Omen failure, overlap rejection, and new-caller token non-reuse.
- [ ] 7.2i Add WARP/Origin-CA tests for macOS-workstation and Ubuntu-general source routing, identical-source equivalence without lifecycle collapse, other-host/workload denial, generic-pattern exclusion, bounded non-persistent enrollment, connected-client no-fetch, per-host token replacement, empty Origin-CA destinations, and discovered-consumer blocking.
- [ ] 7.2j Add OS E2E Access tests for exact macOS admission, provenance binding, all-host/workload exclusion, generic-name collision rejection, MCP/Worker namespace separation, request-local injection, `522` blocked status, and post-recovery positive/negative live validation.
- [ ] 7.3 Update operator documentation to distinguish online authority, transition fallback, offline recovery, and retirement eligibility without listing values.
- [ ] 7.4 Run strict OpenSpec validation and focused repository secret-safety/profile tests; report PASS, FAIL, BLOCKED, and UNVERIFIED distinctly.
