# Tasks

- [x] 1. Build the tracked-file classifier, schema, coverage ledger generator, and completeness test.
- [x] 2. Compile and review repository slices with Repomix/OpenCode and record the hydration manifest.
- [x] 3. Run baseline syntax, schema, dependency, secret, reference, asset, documentation, and test gates.
- [x] 4. Implement and test high-confidence bootstrap, home automation, and fleet-provisioning improvements.
- [x] 5. Implement and test high-confidence aid-core and control-plane improvements.
- [x] 6. Implement and test high-confidence site, documentation, accessibility, and content improvements that do not require visual redesign.
- [x] 7. Implement and test high-confidence repository hygiene, workflow, dependency, generated-file, and asset improvements.
- [x] 8. Run two complete no-new-winner convergence passes and produce the final evidence ledger.
- [ ] 9. Run full verification, sync specifications, and archive the completed change.

## Approved 30-item implementation program

These findings are append-only follow-on work. A checked legacy convergence task does not imply that any item below is complete.

### Wave A — exploit and bootstrap safety

- [x] R01 Replace the Syncoid forced-command prefix check plus `/bin/sh -c` execution with an argv-safe allowlisted dispatcher; reject metacharacters, unknown flags, unrelated datasets, unrestricted shells, and administrative commands.
- [x] R02 Remove blanket passwordless sudo from bootstrap; grant the minimum command set for the bounded phase and revoke/expire temporary elevation.
- [x] R05 Remove destructive Git mutation from bootstrap; preserve local work and use explicit, provenance-checked update behavior.
- [ ] R08 Replace unauthenticated `ssh-keyscan` trust-on-first-use with pinned/approved host-key verification and an explicit enrollment path. (Unsafe automatic trust removed; explicit pinned enrollment remains.)
- [ ] R09 Eliminate mutable unverified remote installer execution; pin artifacts or commits and verify checksums/signatures before execution, including documentation examples.
- [ ] R14 Make critical post-install failures fail the owning operation with structured evidence instead of warning and continuing.
- [ ] R15 Make drift checks fail on missing, unreadable, unexpectedly empty, or mismatched sources and prove the expected identity before success.

### Wave B — secret, backup, scheduler, and storage authority

- [ ] R04 Route all operational secret consumers through `get-secret` backed authoritatively by scoped Infisical identities; remove direct backend bypasses and broad caller-selected scopes. Allow protected local material only for declared machine-scoped offline/pre-network dependencies, never as silent fallback. (`fleet-backup-recovery` owns implementation evidence.)
- [ ] R06 Remove plaintext Autorestic secret persistence; resolve credentials at execution into protected runtime delivery and verify logs/process listings remain secret-free. (`fleet-backup-recovery`.)
- [x] R07 Separate Restic repository passwords from age or recovery identities; store operational references in Infisical and keep only the independently required recovery escrow. (`fleet-backup-recovery`.)
- [ ] R12 Implement ZFS discover/plan/apply/status with mutation gates, per-pool serialization, destination/device identity checks, and honest running/pending states. (`fleet-backup-recovery`.)
- [ ] R13 Detect and reconcile overlapping cron, systemd, Sanoid, Proxmox, and backup schedules; replace an owner only after its successor is verified. (`fleet-backup-recovery`.)

### Wave C — CI, catalog, dependency, and source provenance

- [ ] R10 Remove nonblocking CI from required validation; preserve intentional platform skips as explicit results and fail real test errors.
- [ ] R11 Make pull-request tests execute the checked-out revision and local generated artifacts, never production or mutable remote code as the test subject.
- [ ] R23 Enforce a strict runtime schema for every `software.yml` entry, reject unknown/incomplete fields, and deterministically validate/generated derived catalogs.
- [ ] R24 Collapse provisioning-source drift to one canonical bootstrap source plus a deterministic generated portable fallback whose regeneration is tested.
- [ ] R26 Remove unused root dependencies, correct workspace scripts, and make root test commands cover every intended package without accidental network/deploy side effects.

### Wave D — authenticated control plane and observability

- [ ] R03 Require authenticated and authorized access for desired-state reads, previews, and mutations; enforce tenant/host scope before returning sensitive infrastructure metadata.
- [ ] R16 Replace the fake API-key endpoint with real secret-reference provisioning or remove it; never return placeholder credentials as success.
- [ ] R17 Replace the fake GitHub ensure endpoint with idempotent provider-backed reconciliation or remove it; report unsupported/unconfigured states honestly.
- [ ] R18 Authenticate and integrity-protect software-health receipts, bind them to host/tenant and replay window, and reject unauthenticated submissions.
- [ ] R19 Decompose the control-plane monolith along authenticated domain boundaries with explicit dependency injection and unchanged public behavior under tests.
- [ ] R20 Eliminate `any` at security and runtime boundaries; use strict TypeScript plus Zod parsing for requests, bindings, provider responses, persisted state, and events.
- [ ] R21 Add bounded request bodies, per-principal rate limits, consistent redacted error envelopes, cancellation/timeouts, and safe retry semantics.
- [ ] R22 Add Worker observability with structured redacted logs, traces/metrics where supported, bounded labels, request correlation, Sentry server-side baselines, and evidence that failures route correctly.

### Wave E — governance, consent, site, and truthful docs

- [x] R25 Enforce Frontier-only (`claude`, `codex`, or `antigravity`) OpenSpec architecture mechanically; reject missing/invalid Architect declarations and OpenCode-authored architectural artifacts.
- [ ] R27 Gate GTM and nonessential analytics on explicit consent before loading, persist the decision, and verify accept/reject/revoke behavior.
- [ ] R28 Make documentation-only changes trigger the correct build/deploy validation path while preventing tests from deploying as a side effect.
- [ ] R29 Modernize inherited site dependencies and build/security foundations without visual redesign; full SaaS UI remains blocked on an approved Figma artifact.
- [ ] R30 Rebuild public information architecture, navigation, metadata, PWA behavior, and capability claims from deployed truth; do not present isolated `aid-core` contracts as shipped functionality.

### Verification and closure

- [ ] R31 Run focused regression suites per wave, then the full repository suite, secret scan, generated-artifact drift check, OpenSpec validation, and two fresh no-new-winner convergence passes.
- [ ] R32 Update the requirement-to-file-to-test/host evidence ledger, preserve blocked live-host items as blocked rather than complete, sync the OpenSpec/Paperclip linkage, and archive only after implementation evidence exists.

## Infisical program repository gates

These tasks enforce the 30 runtime requirements owned by `fleet-backup-recovery`; they do not duplicate or replace its per-workload evidence.

- [ ] IG01 Add a strict manifest/schema and immutable-production-scope gate covering I01–I06 and I10; reject shared identities, recursive exports, runtime scope overrides, mixed bootstrap/application credentials, and hidden inherited grants.
- [ ] IG02 Add credential-lifecycle and CI/platform federation gates covering I07–I09 and I25–I26; reject indefinite Universal Auth credentials, stored CI secrets where OIDC is supported, and platform bindings that become competing authorities.
- [ ] IG03 Add launcher, delivery, local-exception, and deployment-admission gates covering I13–I19 and I29; prove exact allowlists, environment scrubbing, native bindings, rendered-template cleanup, no assumed Agent cache, and fail-closed reference validation.
- [ ] IG04 Add disaster-recovery provenance gates covering I20–I21; allow age only for the independent recovery envelope and prevent historical-key retirement while retained backups depend on it.
- [ ] IG05 Add authorization, telemetry, alerting, leak, rotation, and dashboard gates covering I11–I12, I22–I24, and I27–I28; require redacted evidence for both permitted and forbidden paths and all six enrollment states.
- [ ] IG06 Add fixture/canary/runtime-class batch verification covering I30; reject rollout receipts without automatic configuration rollback evidence and explicit blocked/failed targets.
- [ ] IG07 Verify the authentication-plane matrix: Cloudflare Access for public humans, claim-bound OIDC for CI/platform workloads, Infisical identities for services, Authentik only for documented local/offline human access or incompatibility, and product-native customer auth.

## Verification evidence

- Tracked-file ledger schema v2: 2,923/2,923 paths carry a disposition, reason, and evidence; zero review gaps.
- Repository suite, pass 1: 61 suites; one expected platform skip; a transient live-header check passed on immediate isolated rerun.
- Repository suite, pass 2: 61 suites; 768 assertions passed; zero failures; one expected Linux-on-macOS skip.
- `packages/aid-core`: TypeScript strict build and 69/69 tests passed.
- Final integration suite: 66 suites; 818 assertions passed; zero failures; one expected Linux-on-macOS skip.
- Additional convergence pass 1 (correctness/security): completed the pipx-to-uv execution, inventory, update, injection, and control-plane command migration; added replacement detail metadata and regression coverage.
- Additional convergence pass 2 (performance/maintainability): fixed eager Flatpak task starts, process-global working-directory races, temporary Brewfile leaks, and swallowed Brew/cask failures; added scheduler regression coverage.
- Additional convergence pass 3 (product/documentation/removal hygiene): corrected 22 stale canonical GitHub links and remaining scoped spelling defects while retaining the intentional GitLab mirror.
- Post-pass integration suite: 67 suites; 826 assertions passed; zero failures; one expected Linux-on-macOS skip.
- OpenCode/Repomix hydration was attempted by bounded repository slice. Oversized slices failed closed at the context ceiling and several gateway responses failed schema parsing; no raw pack or unvalidated child output was injected. Local schema-aware validators and the exhaustive tracked-file ledger supplied coverage for those slices.
- No deployment, CDN purge, live service mutation, or OpenSpec archive was performed.
