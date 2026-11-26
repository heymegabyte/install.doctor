# Design: Age-to-Infisical migration with hardened host profiles

**Architect Role:** assigned

## Authority model

Infisical becomes the authority for online operational secret delivery. Age-encrypted install.doctor material remains authoritative only for enumerated bootstrap, independent recovery, and offline-execution exceptions in `config/infisical/offline-secret-exceptions.json`. Interactive human credentials remain outside host automation.

The migration does not infer authority from secret presence. A value may exist in age and Infisical during transition, but the desired-state manifest records exactly one intended runtime authority, its consumers, owner, environment, and rollback state.

## Value-blind inventory and classification

Discovery reads only encrypted file paths, canonical secret names, repository references, consumer declarations, host facts, identity policy, and Infisical metadata that contains no values. It must not invoke age decryption, print secret-bearing environment variables, read rendered targets, or calculate durable value fingerprints.

Every discovered name receives one disposition:

1. `operational-migrate` — required by an evidenced online workload and eligible for Infisical;
2. `offline-exception` — required without network access and documented with owner, consumer, reason, review date, and recovery test;
3. `blocked-unknown` — ambiguous owner, consumer, sensitivity, or environment; no apply authority;
4. `retirement-candidate` — no remaining consumer, but retained until separately approved deletion.

Aliases and duplicate names must resolve to a canonical name before migration. Conflicting sources, environments, or owners fail planning.

## Hardened host profiles

A profile is a versioned allowlist contract, not a convenience bundle. Selection is bound to a stable enrolled host identity and asserted role; hostname alone is insufficient. The effective grant is the intersection of profile capability groups, platform and environment constraints, observed consumer demand, identity-specific approved additions, and explicit denials.

macOS developer workstations may receive broader development capabilities than servers, but not recovery roots, personal credentials, unrelated production administration, signing roots, or destructive infrastructure credentials by default. Ubuntu runner/server profiles receive service-specific non-interactive grants and no developer-personal bundle. Unknown, renamed, cloned, stale, or role-conflicting hosts receive no operational secrets.

Profiles have an owner, schema version, review/expiry timestamp, maximum grant size, permitted environments, and revocation/downgrade behavior. Expansion produces a reviewable diff and never occurs implicitly from a repository scan. Host identities are independently revocable and cannot impersonate GitHub OIDC workloads.

## Migration state machine

Each secret progresses independently through `inventoried`, `planned`, `written`, `verified`, `consumer-cutover`, `fallback-bounded`, and `retirement-eligible`. Each transition binds to the reviewed plan and records value-free evidence. No transition deletes, rotates, or revokes credentials. Encrypted-source deletion and age-key retirement require a separate destructive change with exact targets and recovery evidence.

## Safe apply

Apply requires a complete deterministic plan, exact source/destination binding, authenticated least-privilege writer identity, concurrency lock, and explicit admission of each secret name. It decrypts one selected value at a time, streams it directly to the Infisical write operation, clears references after the bounded operation, and never stages plaintext on disk or places values in argv, logs, receipts, shell history, telemetry, or Markdown.

Existing destination values are not overwritten blindly. The reconciler reports a value-free conflict and requires an explicit overwrite decision bound to the plan digest. Failure leaves the encrypted source and current runtime path unchanged.

## Consumer cutover and fallback

`get-secret` and workload launchers prefer the exact Infisical project/environment/path authorized for their identity. During a bounded transition, fallback to age is permitted only when the manifest names that secret and consumer as a migration fallback or offline exception. Ambient fallback to the full chezmoi inventory is prohibited.

Cutover verification covers authorized retrieval, unauthorized denial, consumer startup/use, Infisical outage behavior, expired/revoked identity, replacement-host enrollment, profile downgrade, and rollback to the preserved encrypted source. Evidence records names, paths, identity IDs, statuses, timestamps, and plan digests only.

## GitHub and non-host identities

CI uses repository-and-environment-bound GitHub OIDC with exact claims and secret-name allowlists. Host machine identities, CI identities, release signers, backup/restore identities, and human operators remain separate. No long-lived host credential is copied into GitHub, and no CI identity inherits a host profile.

## Rollout and rollback

Roll out one capability group and one host class at a time: read-only inventory, reviewed plan, writer canary, authorized/unauthorized retrieval, consumer canary, outage/rollback drill, then bounded expansion. macOS developer-workstation and Ubuntu server/runner profiles require independent evidence.

Rollback restores consumer resolution to the preserved encrypted source for only the affected allowlisted names, revokes or disables the new host binding when safe and authorized, and leaves unrelated Infisical paths and identities untouched. Because this change does not delete encrypted sources or rotate credentials, rollback remains available throughout the migration window.

## Key risks and mitigations

- **Broad workstation grant:** constrain profiles by identity, capability, environment, explicit denials, maximum size, and expiry.
- **Secret disclosure during audit:** inspect names/metadata only; prohibit value fingerprints, rendered targets, environment dumps, and value-bearing logs.
- **Dual authority drift:** record intended runtime authority and bounded fallback state per secret; fail on conflicting sources.
- **Infisical outage locks out recovery:** preserve tested offline exceptions and execute outage/replacement-host drills before retirement eligibility.
- **Overwrite of a newer destination value:** fail closed on value-free conflict unless an exact plan-authorized overwrite is approved.
- **Cloned or renamed host inherits access:** bind grants to enrolled immutable identity, not hostname; deny stale or conflicting identity facts.
- **Profile expansion by repository noise:** require explicit capability admission and reviewable diff; discovery alone never grants access.
- **Premature cleanup:** deletion, rotation, revocation, and age-key retirement remain separately authorized destructive work.
