# Tasks

## 1. Value-free inventory and disposition

- [x] 1.1 Implement deterministic discovery and planning from secret names, repository evidence, host roles, and value-free Infisical bindings.
- [ ] 1.2 Produce a complete name-only inventory of encrypted chezmoi sources and map every name to `operational-migrate`, `offline-exception`, `blocked-unknown`, or `retirement-candidate` with owner and consumer evidence.
- [ ] 1.3 Canonicalize aliases and duplicates; fail planning on conflicting owner, environment, source, or destination metadata.
- [ ] 1.4 Verify discovery never decrypts values, reads rendered secret targets, dumps secret-bearing environments, or writes durable value fingerprints.

## 2. Host-profile hardening

- [ ] 2.1 Replace broad role bundles with versioned deny-by-default profiles bound to stable enrolled host identity, role, platform, environment, permitted capability groups, explicit denials, owner, expiry/review, and maximum grant size.
- [ ] 2.2 Harden the macOS developer-workstation profile to exclude recovery roots, personal credentials, unrelated production administration, signing roots, and destructive infrastructure credentials unless individually evidenced and approved.
- [ ] 2.3 Harden Ubuntu server/runner profiles to service-specific non-interactive grants with no inherited developer-personal bundle.
- [ ] 2.4 Add negative tests for unknown, cloned, renamed, stale, role-conflicting, expired, oversized, and implicitly expanded host profiles.
- [ ] 2.5 Add deterministic profile-diff, downgrade, revocation, and re-enrollment tests without resolving secret values.

## 3. Safe migration engine

- [x] 3.1 Implement masked, in-memory Infisical apply operations for explicitly selected names.
- [ ] 3.2 Enforce the per-secret migration state machine and bind every transition to an exact reviewed plan digest.
- [ ] 3.3 Add concurrency locking and fail-closed destination-conflict handling; require separately admitted overwrite without exposing either value.
- [ ] 3.4 Prove selected values travel memory-only to the exact Infisical project/environment/path and never enter disk staging, argv, logs, receipts, history, telemetry, or Markdown.
- [ ] 3.5 Keep deletion, rotation, revocation, permission widening, encrypted-source removal, and age-key retirement outside apply authority.

## 4. Identity and destination reconciliation

- [ ] 4.1 Reconcile Infisical projects, environments, paths, exact secret-name grants, and independently revocable host identities from the reviewed plan.
- [ ] 4.2 Reconcile repository-and-environment-bound GitHub OIDC identities without copying host credentials into CI.
- [ ] 4.3 Separate host, CI, release, backup/recovery, and human identities and verify cross-identity denial.
- [ ] 4.4 Record identity owners, expiry, renewal, revocation, and break-glass procedures without credential material.

## 5. Consumer cutover and bounded fallback

- [ ] 5.1 Make online consumers prefer their exact Infisical path and permit age fallback only for manifest-declared transition or offline exceptions.
- [ ] 5.2 Canary one capability group on macOS and one on Ubuntu through authorized retrieval, unauthorized denial, and real consumer use without printing values.
- [ ] 5.3 Execute Infisical outage, expired/revoked identity, replacement-host, profile-downgrade, and rollback drills for both host classes.
- [ ] 5.4 Verify normal online operation cannot fall back to the full chezmoi inventory and unknown names fail closed.

## 6. Recovery and retirement gates

- [ ] 6.1 Validate every offline exception has owner, consumer, reason, review date, minimum scope, and executed recovery evidence.
- [ ] 6.2 Demonstrate independent recovery using only the declared exception set; do not delete or modify source material during the drill.
- [ ] 6.3 Produce a value-free retirement-eligibility report after the observation window, with exact remaining blockers per secret.
- [ ] 6.4 Leave all encrypted templates, age identities, and credentials intact; propose any deletion, rotation, or revocation as a later separately approved destructive change.

## 7. Verification and documentation

- [x] 7.1 Preserve existing deterministic planner and secret-safety test coverage as the migration foundation.
- [ ] 7.2 Add adversarial tests for value leakage, broad grants, alias collision, stale identity, destination conflict, partial failure, retry, outage, and rollback.
- [ ] 7.3 Update operator documentation to distinguish online authority, transition fallback, offline recovery, and retirement eligibility without listing values.
- [ ] 7.4 Run strict OpenSpec validation and focused repository secret-safety/profile tests; report PASS, FAIL, BLOCKED, and UNVERIFIED distinctly.
