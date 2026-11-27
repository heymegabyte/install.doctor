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

### Source precedence and explicit directory overrides

The audit found a source-precedence defect: discovery could prefer the `secrets-workstation` inventory whenever it existed, regardless of the selected host. That behavior can leak macOS-specific selection into Ubuntu and other host plans.

Default source selection is host-bound:

- `macos.megabyte.space` uses `secrets-workstation` as its host-specific override inventory, with the general inventory supplying only names not overridden under the reviewed merge contract;
- Ubuntu and every other host use the general encrypted secret inventory by default and must not consult `secrets-workstation`; and
- `--secret-directory <exact-directory>` may replace default source selection only for the one explicitly selected host and one invocation.

The directory override is non-persistent, plan-visible, path-normalized, restricted to an approved encrypted-inventory root, and incompatible with multi-host selection. It grants no additional secret names: profile, project, path, identity, disposition, and destination checks still apply. Missing, ambiguous, overlapping, symlink-escaped, or undeclared directories fail closed.

### AI provider credential placement

Raw AI upstream/provider keys belong only to the Ubuntu-hosted LiteLLM runtime project and identity. They are server-side provider credentials and must not be granted to the macOS developer workstation, placed in its project, or returned through its host profile.

macOS receives only scoped LiteLLM client keys needed to call the gateway. Client keys have bounded model/team/budget authority and cannot administer LiteLLM, enumerate provider credentials, or bypass the gateway to call upstream providers directly. Classification distinguishes `ai-upstream-provider` from `litellm-client`; aliases or names that blur that boundary fail planning.

### Acceptance scenarios

1. **macOS default inventory:** selecting only `macos.megabyte.space` uses its declared `secrets-workstation` overrides plus the allowed general fallback and records both sources without values.
2. **Ubuntu default inventory:** selecting Ubuntu ignores `secrets-workstation`, even when that directory exists and contains a colliding name, and plans from the general inventory only.
3. **Other-host default inventory:** an undeclared or non-macOS host cannot inherit workstation overrides.
4. **Explicit directory override:** `--secret-directory` affects exactly one selected host and one plan, is visible in the plan digest, and does not persist or widen the allowlist.
5. **Unsafe override:** multi-host, missing, unapproved, ambiguous, or symlink-escaping directory overrides fail before decryption or external mutation.
6. **AI upstream isolation:** Ubuntu/LiteLLM can resolve its allowlisted raw provider key; macOS receives `403` or no grant for that key.
7. **LiteLLM client access:** macOS can resolve only its scoped LiteLLM client key and use the gateway without receiving an upstream provider key.

## Hardened host profiles

A profile is a versioned allowlist contract, not a convenience bundle. Selection is bound to a stable enrolled host identity and asserted role; hostname alone is insufficient. The effective grant is the intersection of profile capability groups, platform and environment constraints, observed consumer demand, identity-specific approved additions, and explicit denials.

macOS developer workstations may receive broader development capabilities than servers, but not recovery roots, personal credentials, unrelated production administration, signing roots, or destructive infrastructure credentials by default. Ubuntu runner/server profiles receive service-specific non-interactive grants and no developer-personal bundle. Unknown, renamed, cloned, stale, or role-conflicting hosts receive no operational secrets.

Profiles have an owner, schema version, review/expiry timestamp, maximum grant size, permitted environments, and revocation/downgrade behavior. Expansion produces a reviewable diff and never occurs implicitly from a repository scan. Host identities are independently revocable and cannot impersonate GitHub OIDC workloads.

### Free-plan project isolation

Host-class isolation is enforced with separate Infisical projects: one for the macOS host profile and one for the Ubuntu host profile. Each machine identity has **No Access** at the organization level and **Viewer** only in its assigned host project. Secrets are stored at that project's root secret path; separation does not depend on paid path-scoped roles.

The macOS identity cannot enumerate or read the Ubuntu project, and the Ubuntu identity cannot enumerate or read the macOS project. Cross-project reads must return `403`; a missing secret or empty result is not sufficient denial evidence. Project IDs and identity IDs may appear in value-free receipts, but credentials and secret values may not.

### Host-declared project and path routing

Every host entry in desired state declares an exact `projectId` and `secretPath`. The pair is atomic routing authority: authentication, reads, verification, migration planning, and rollback must use both values from the selected host declaration. A valid identity with an absent, mismatched, or undeclared pair fails closed before secret resolution.

Dedicated macOS and Ubuntu hosts use their respective isolated host project with `secretPath: /`. Legacy managed workstations that have not completed project isolation may temporarily declare the existing Global project plus their exact host-scoped path. This compatibility route is explicit, host-by-host, observable, and retirement-tracked; it does not permit another host, an unknown hostname, or a new enrollment to inherit Global access.

The CLI `--project-id` option is a single-host operational override only. It may replace the declared project for the one explicitly selected host during a reviewed migration or recovery action, but it does not change other hosts, does not persist desired state, does not select a secret path, and cannot make an undeclared host eligible. The host declaration's `secretPath` remains mandatory unless an equally explicit single-host path override is separately supported and plan-bound.

Ambient project selection is prohibited. The reconciler and runtime resolver must not read project authority from the current working directory, `.infisical.json`, home-directory configuration, a repository-local default, or an Infisical CLI remembered project. They pass the declared project ID and path explicitly on every operation and verify the returned project context before accepting a result.

### Workload target model

Workloads are a separate target class from hosts. The manifest entry `workloads.mcp.megabyte.space` declares Infisical project ID `4ae065b0-c081-454e-a513-220a28e5d2f0` and `secretPath: /`. Its identity, capability groups, source policy, validator policy, destinations, consumers, and retirement state are workload-scoped and cannot be inherited from a host profile.

CLI selection is exclusive: exactly one of `--host <id>` or `--workload <id>` may be supplied for a targeted plan/apply. Supplying both, neither where an explicit target is required, multiple targets, an unknown target, or using a host override with a workload fails before inventory resolution. `--project-id` and any secret-directory override remain single-target overrides and cannot change the target class.

Workload discovery uses only the general encrypted inventory. It must never merge or consult `secrets-workstation`, even when run on macOS or from a workstation checkout. Repository location, executing machine, cwd, home configuration, and host identity do not alter workload source precedence.

### MCP workload credential placement

Cloudflare-native provider credentials required by the MCP portal/control-plane runtime are classified for `workloads.mcp.megabyte.space` and routed only to project `4ae065b0-c081-454e-a513-220a28e5d2f0` at `/`. They are not host credentials and must not appear in macOS, Ubuntu/LiteLLM, legacy Global workstation, CI, or human profiles unless a separate consumer contract explicitly defines a different credential.

The MCP workload may receive only credentials evidenced by its Cloudflare-native consumers. This placement does not grant a host access merely because that host administers, deploys, or tests the workload. Cross-target reads must fail with `403` where authorization is evaluated.

### Universal Auth lifecycle and local credential storage

Host identities authenticate through Infisical Universal Auth. Access tokens have a 900-second lifetime and a maximum of two uses. Universal Auth client secrets have a 90-day lifetime and require an owner, expiry observation, renewal procedure, overlap-safe replacement, and revocation path.

The macOS client secret is stored in the logged-in user's macOS Keychain with access limited to the intended resolver. The Ubuntu client secret is stored in a root- or service-owned mode-`0600` file outside the repository and rendered configuration. Neither credential may be placed in chezmoi source, shell profiles, argv, logs, telemetry, Markdown, or Infisical project secrets.

## Migration state machine

Each secret progresses independently through `inventoried`, `planned`, `written`, `verified`, `consumer-cutover`, `fallback-bounded`, and `retirement-eligible`. Each transition binds to the reviewed plan and records value-free evidence. A single reviewed canary may advance from `retirement-eligible` to `source-retired` only after allowed-read, cross-project `403`, consumer, and rollback acceptance evidence. All non-canary deletion, credential rotation/revocation, encrypted-source retirement, and age-key retirement remain separately authorized destructive work.

## Safe apply

Apply requires a complete deterministic plan, exact source/destination binding, authenticated least-privilege writer identity, concurrency lock, and explicit admission of each secret name. It decrypts one selected value at a time, streams it directly to the Infisical write operation, clears references after the bounded operation, and never stages plaintext on disk or places values in argv, logs, receipts, shell history, telemetry, or Markdown.

Existing destination values are not overwritten blindly. The reconciler reports a value-free conflict and requires an explicit overwrite decision bound to the plan digest. Failure leaves the encrypted source and current runtime path unchanged.

### Durable metadata-only validation ledger

Credential validity is recorded in a durable value-free ledger separate from secret material. Each record binds a canonical credential name, source inventory reference, intended owner/consumer, classification, validator identity and version, validation method, validation scope/environment, status, observed time, expiry or freshness deadline, and evidence reference. It must not contain the credential value, reversible encoding, response body, authorization header, value hash/fingerprint, or enough low-entropy metadata to reconstruct or test the secret offline.

Allowed admission status is exactly `valid`. `invalid-retired` records document credentials proven invalid and intentionally excluded from migration; they are evidence for retirement classification, never apply authority. Missing, `unverified`, `invalid-retired`, expired, stale, scope-mismatched, validator-unknown, or provenance-incomplete records fail admission.

Validator provenance is allowlisted and purpose-specific. A syntax check cannot validate live authorization; a provider validation cannot be reused for another environment or credential class. The plan binds the exact ledger record and evidence digest so status cannot change between review and apply without invalidating the plan.

### Hard pre-write apply gate

Before decrypting any selected source or issuing any external write, apply validates the complete selected set. Every credential must have a current `valid` ledger record whose canonical name, source reference, destination, owner/consumer, environment, validator method, and plan binding match. Admission is all-or-nothing: one rejected record aborts the entire apply before the first write. Apply does not partially migrate the remaining valid subset unless a new reduced plan is explicitly generated and reviewed.

The gate runs again immediately before mutation under the apply lock. Ledger changes, freshness expiry, destination drift, or selection changes invalidate the plan and require re-planning. Validation does not authorize overwrite, permission widening, deletion, rotation, or source retirement.

Workload targets pass through the identical ledger gate. Every workload-selected credential requires a fresh matching `valid` record whose provenance binds the workload ID, general-inventory source, project ID, root path, consumer, environment, validator, and plan. A host validation record cannot admit a workload credential, and a workload validation record cannot admit a host credential.

### Migration and source-retirement evidence

A successful write records value-free migrated-destination evidence: canonical credential name, destination project/environment/path, destination metadata/version identifier where safely available, writer identity, plan digest, timestamp, and post-write authorized-read/unauthorized-denial result. It records no value or value fingerprint.

Workload migration additionally requires a round-trip gate: after write, the workload identity resolves the exact destination through the production-equivalent access path, the intended Cloudflare-native consumer can use it in a bounded non-destructive check, and representative host/cross-project identities are denied. Failure rolls back or leaves the source authoritative and prevents cutover/retirement evidence.

A source-retirement assertion binds the exact encrypted source path/name, canonical credential, completed migration evidence, consumer cutover evidence, validation record, observation window, rollback/recovery state, approving change, and retirement timestamp. The assertion must distinguish `retirement-eligible`, `source-retired`, and `invalid-retired`. It is rejected if the destination evidence is absent, mismatched, stale, or does not prove the intended consumer boundary. A canary assertion grants no authority over another source.

### Validation-ledger acceptance scenarios

1. **Complete valid selection:** every selected credential has fresh matching `valid` provenance; preflight may proceed to the separately authorized write phase.
2. **One missing record:** a batch containing one credential without a ledger record aborts before decryption and writes nothing.
3. **Unverified record:** `unverified` is rejected even when the source and destination exist.
4. **Invalid retired record:** `invalid-retired` is excluded and cannot be revived by apply or a directory/project override.
5. **Stale or wrong-scope provenance:** expired evidence or validation against another environment/provider/consumer aborts the whole plan.
6. **Ledger race:** a record changed after plan review invalidates the plan at the locked pre-write gate.
7. **Destination evidence:** a completed migration produces metadata-only destination and positive/negative access evidence without value fingerprints.
8. **Retirement assertion:** only the exact source with matching migration, cutover, validation, observation, and recovery evidence may be asserted retired.

### Workload-target acceptance scenarios

1. **MCP workload routing:** `--workload mcp.megabyte.space` selects project `4ae065b0-c081-454e-a513-220a28e5d2f0`, root path `/`, and the general inventory only.
2. **Host/workload exclusivity:** supplying `--host` and `--workload` together fails before inventory access, decryption, authentication, or mutation.
3. **Unknown or multiple workload:** an undeclared workload or multi-workload selection fails closed and cannot inherit the executing host's profile.
4. **Workstation inventory exclusion:** MCP workload planning ignores `secrets-workstation` even when a colliding name exists there or execution occurs on macOS.
5. **Ledger target binding:** a credential with a valid host ledger record but no matching MCP workload record is rejected before write.
6. **Cloudflare provider placement:** an approved Cloudflare-native provider credential is planned for the MCP workload and excluded from all host plans.
7. **Round trip:** after migration, the MCP workload identity retrieves and exercises the exact credential through the production-equivalent Cloudflare-native path without exposing its value.
8. **Cross-target denial:** macOS, Ubuntu/LiteLLM, and legacy workstation identities receive `403` for the MCP workload credential and destination.

## Consumer cutover and fallback

`get-secret` and workload launchers prefer the exact Infisical project/environment/path authorized for their identity. During a bounded transition, fallback to age is permitted only when the manifest names that secret and consumer as a migration fallback or offline exception. Ambient fallback to the full chezmoi inventory is prohibited.

Cutover verification covers authorized retrieval, unauthorized denial, consumer startup/use, Infisical outage behavior, expired/revoked identity, replacement-host enrollment, profile downgrade, and rollback to the preserved encrypted source. Evidence records names, paths, identity IDs, statuses, timestamps, and plan digests only.

## GitHub and non-host identities

CI uses repository-and-environment-bound GitHub OIDC with exact claims and secret-name allowlists. Host machine identities, CI identities, release signers, backup/restore identities, and human operators remain separate. No long-lived host credential is copied into GitHub, and no CI identity inherits a host profile.

## Rollout and rollback

Roll out one capability group and one host class at a time: read-only inventory, reviewed plan, writer canary, authorized retrieval from the assigned root path, cross-project `403`, consumer canary, outage/rollback drill, then bounded expansion. macOS developer-workstation and Ubuntu server/runner profiles require independent evidence. Canary source retirement is evidence that the retirement mechanism works, not authority for bulk retirement.

Rollback restores consumer resolution to the preserved encrypted source for only the affected allowlisted names, revokes or disables the new host binding when safe and authorized, and leaves unrelated Infisical paths and identities untouched. Because this change does not delete encrypted sources or rotate credentials, rollback remains available throughout the migration window.

## Key risks and mitigations

- **Broad workstation grant:** constrain profiles by identity, capability, environment, explicit denials, maximum size, and expiry.
- **Secret disclosure during audit:** inspect names/metadata only; prohibit value fingerprints, rendered targets, environment dumps, and value-bearing logs.
- **Dual authority drift:** record intended runtime authority and bounded fallback state per secret; fail on conflicting sources.
- **Infisical outage locks out recovery:** preserve tested offline exceptions and execute outage/replacement-host drills before retirement eligibility.
- **Overwrite of a newer destination value:** fail closed on value-free conflict unless an exact plan-authorized overwrite is approved.
- **Cloned or renamed host inherits access:** bind grants to enrolled immutable identity, not hostname; deny stale or conflicting identity facts.
- **Free-plan role limits weaken path isolation:** isolate host classes into separate projects, assign organization No Access and project Viewer, and verify cross-project `403`.
- **Ambient CLI state routes a host to the wrong project:** require the host-declared `projectId`/`secretPath` pair on every operation and reject cwd/home/remembered-project inference.
- **Migration override broadens the fleet:** constrain `--project-id` to one explicitly selected host, keep it non-persistent, and retain the declared path and identity checks.
- **Workstation inventory overrides Ubuntu:** bind `secrets-workstation` to `macos.megabyte.space`; make every alternate directory an explicit single-host `--secret-directory` override.
- **Raw provider key reaches a developer laptop:** classify upstream and client keys separately, keep upstream keys in Ubuntu/LiteLLM only, and verify macOS denial.
- **Long-lived local bootstrap credential leaks:** cap client secrets at 90 days, store them in Keychain or a mode-`0600` Ubuntu file, and use 900-second/max-two-use access tokens.
- **Profile expansion by repository noise:** require explicit capability admission and reviewable diff; discovery alone never grants access.
- **Canary retirement is mistaken for bulk authority:** bind retirement to the exact reviewed canary; deletion, rotation, revocation, and age-key retirement otherwise remain separately authorized destructive work.
- **Stale or fabricated validity admits a bad credential:** require allowlisted validator provenance, freshness, exact scope, evidence binding, and a locked recheck before any write.
- **Batch partially writes before discovering an invalid record:** validate the entire selected set atomically before decryption and mutation; require a new plan for any reduced retry.
- **Validation evidence leaks the credential:** prohibit values, fingerprints, response bodies, and replayable request material from the ledger and migration receipts.
- **Retirement assertion outruns migration evidence:** require exact destination, consumer cutover, denial, observation-window, and recovery bindings per source.
- **Workload inherits operator host access:** separate target classes, make `--workload` mutually exclusive with `--host`, and deny host-profile reuse.
- **Workload execution on macOS selects workstation overrides:** force workloads to the general inventory independent of executing machine or cwd.
- **Cloudflare provider credentials spread to hosts:** classify them as MCP-workload-only and test their absence from every host plan plus cross-project `403`.
