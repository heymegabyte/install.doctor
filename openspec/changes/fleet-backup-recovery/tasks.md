# Tasks

- [x] Record proposal, design, safety boundaries, and acceptance semantics.
- [x] Add strict fleet-protection policy, plan, and observed-evidence contracts with focused tests.
- [x] Add portable read-only host/ZFS assessment and redaction tests.
- [ ] Add atomic configuration renderers and one-scheduler detection for Sanoid, scrub, Syncoid, Restic/PBS, and Alloy.
- [ ] Make Infisical authoritative behind `get-secret`; bind project/environment/path/action scope in desired state and prove permitted reads plus denied cross-host, cross-environment, administrative, recovery-root, and caller-supplied-scope access without exposing values. (Fail-closed resolver implemented; live allow/deny matrix pending.)
- [ ] Inventory every pre-network/offline secret dependency; eliminate routine age/SOPS storage; implement only approved machine-scoped local bootstrap exceptions with protected permissions, explicit expiry/revocation behavior, and tests proving they cannot become a general fallback.
- [ ] Add the minimal independently stored encrypted recovery package and isolated unlock drill. Keep age, if selected, confined to the recovery envelope; preserve historical keys until their restore points expire or are re-keyed.
- [ ] Add structured protection events, metrics, dashboard bindings, alerts, and Loki query proof.
- [ ] Run disposable restore drills, canary rollout, idempotency checks, and configuration rollback.
- [ ] Repair Zen only after verified independent backup, exact affected-object recovery source, replacement-device decision, and maintenance authorization.
- [ ] Complete the requirement-to-file-to-host-to-verification ledger and archive only after all evidence exists.

## Approved Infisical program (append-only)

No item below is complete until its manifest, implementation, allowed/denied tests, and runtime evidence are linked in the requirement-to-file-to-host-to-verification ledger.

### Wave I — authority, identities, and immutable scope

- [ ] I01 One independently revocable Infisical identity per workload—not per host or fleet.
- [ ] I02 Prefer OIDC or platform-native authentication; reserve Universal Auth for runtimes lacking federation.
- [ ] I03 Create a versioned manifest mapping workload → project → environment → fixed path → exact secret names.
- [ ] I04 Inject only explicit allowlisted variables, never recursively export a project or parent path.
- [ ] I05 Reject runtime overrides of project, environment, and path in production.
- [ ] I06 Separate bootstrap identity credentials from application secrets.
- [ ] I10 Detect additive permissions—narrow grants do not neutralize inherited broad roles.

### Wave II — credential lifecycle and federated automation

- [ ] I07 Use short-lived access tokens with deliberate TTL, maximum TTL, maximum uses, and trusted-IP policies.
- [ ] I08 Set finite Universal Auth client-secret lifetimes and expiration alerts.
- [ ] I09 Test urgent revocation by removing the issuing credential or identity; token revocation can have a cache window.
- [ ] I25 Use GitHub OIDC with repository/ref/environment claims rather than stored CI client secrets.
- [ ] I26 Reconcile Cloudflare/Vercel/platform bindings from Infisical so they do not become conflicting authorities.

### Wave III — bounded delivery and deployment admission

- [ ] I13 Make get-secret the single-secret portability interface everywhere.
- [ ] I14 Add a manifest-driven process launcher for services requiring multiple environment variables.
- [ ] I15 Scrub unrelated secret-shaped variables from child-process environments.
- [ ] I16 Prefer systemd credentials, orchestrator secret mounts, or native platform bindings over long-lived environment variables.
- [ ] I17 Treat rendered Agent templates as persistent secret material with atomic permissions and cleanup.
- [ ] I18 Do not treat Infisical Agent as an undocumented general-purpose offline cache.
- [ ] I19 Require an explicit threat model, expiry, and revocation policy for every local secret exception.
- [ ] I29 Block deployment when a referenced secret is absent, unauthorized, or mapped outside the workload manifest.

### Wave IV — independent recovery continuity

- [ ] I20 Keep age only as an independently held disaster-recovery envelope where necessary.
- [ ] I21 Preserve historical recovery keys until every retained backup using them expires or is re-keyed.

### Wave V — authorization proof, telemetry, leak prevention, and rotation

- [ ] I11 Add automated allowed and denied authorization tests for every workload.
- [ ] I12 Test denial across hosts, repositories, environments, parent paths, administration, and recovery roots.
- [ ] I22 Add metadata-only access telemetry: identity, workload, secret reference, action, and outcome.
- [ ] I23 Alert on unusual denied reads, parent-path attempts, authentication changes, and expiring credentials.
- [ ] I24 Add secret-leak checks covering logs, process listings, crash reports, recordings, and generated configuration.
- [ ] I27 Add automatic rotation drills proving consumers reload successfully before retiring the prior version.
- [ ] I28 Add a repository enrollment status dashboard: unenrolled, manifest missing, overbroad, verified, stale, or revoked.

### Wave VI — bounded deployment

- [ ] I30 Roll out in bounded batches: fixtures, one canary per runtime class, then the remaining estate with automatic rollback.

## Infisical acceptance evidence

- [ ] E01 Commit the schema-validated workload manifest and deterministic redacted plan; prove production ignores/rejects project, environment, and path overrides.
- [ ] E02 For every workload, link successful exact-name reads and failed cross-host, cross-repository, cross-environment, parent-path, administration, and recovery-root reads without secret values.
- [ ] E03 Record issuer, auth mode, claims, TTL/max TTL/max uses, client-secret expiry, trusted-IP rationale, inherited grants, and revocation latency for each identity.
- [ ] E04 Prove launchers contain only allowlisted delivery, scrub unrelated secret-shaped variables, use the strongest native delivery mechanism available, and clean persistent rendered templates atomically.
- [ ] E05 Prove CI uses claim-bound OIDC, platform bindings reconcile from references without becoming authorities, and invalid/missing/out-of-manifest references block deployment.
- [ ] E06 Query metadata-only access and alert events; attach leak-scan results for logs, process listings, crash reports, recordings, generated files, and repository history.
- [ ] E07 Complete rotation/reload, urgent-revocation, offline-recovery, and historical-key-retention drills before retiring old credentials or keys.
- [ ] E08 Publish per-repository enrollment states and fixture/canary/batch outcomes, including automatic configuration rollback evidence and honest blockers.
