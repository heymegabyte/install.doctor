# Design

> **Architect:** codex
> **Architect Role:** assigned

## Authority and evidence

`ENVIRONMENT.md` remains desired state. A strict protection manifest adds machine capabilities, workload RPO/RTO, secret references, destinations, exclusions by capability, and scheduler ownership. Observed evidence is stored separately and can never be inferred from desired state.

## Reconciliation

Discovery is read-only and emits redacted JSON. Planning validates source mounts, destination identity/boundaries, encryption compatibility, capacity, scheduler uniqueness, and required secret references before producing stable actions. Apply is a separate privileged adapter. Status derives `unknown`, `stale`, `running`, `failed`, or `verified` only from timestamped evidence.

## Storage safety

ZFS actions serialize per pool. A resilver blocks scrub. Permanent errors and unhealthy hardware block automatic clearing or mutation. Syncoid plans default to no target deletion or rollback, preserve common snapshots/bookmarks/holds/resume tokens, and use restricted identities. Restic or an established PBS path supplies an independent encrypted copy; local snapshots never satisfy independent-backup requirements.

## Secrets and recovery

Infisical is the sole authority for operational machine and application secrets. `get-secret` remains the universal caller interface, but enrolled targets resolve through a workload identity whose project, environment, path, and actions are fixed by desired state rather than caller input. Ordinary configuration contains references only. Resolution fails closed when Infisical is unavailable; it never falls back to a controller keyring, broad export, committed environment file, or routine age/SOPS store.

A protected machine-local value is allowed only when a declared dependency must operate before networking or Infisical can exist, or during an explicitly invoked offline recovery drill. Each exception is machine-scoped, least-privilege, permission-checked, lifecycle-bounded, recorded in the authorization matrix, and denied to ordinary post-bootstrap callers. It must not become a silent general-purpose cache or fallback.

Offline recovery remains independent of the infrastructure it restores. The recovery package contains the minimum historical key material and nonsecret dependency metadata required to unlock retained backups, datasets, and protected artifacts without Infisical or the controller. It is held outside the primary failure domain and encrypted with an established, independently recoverable mechanism; age may be used only as that narrow recovery envelope, never as the routine operational secret authority. Recovery-key rotation retains historical material until all covered restore points expire or are re-keyed, and isolated drills prove both unlock and denial boundaries without exposing values.

## Identity and authentication boundaries

- **Public-facing human access:** Cloudflare Access authenticates and authorizes operators before public administrative surfaces. It is not an application-secret store.
- **CI and platform workloads:** GitHub OIDC or the platform's native workload identity is preferred, with repository/ref/environment or equivalent claims bound to the exact workload. Stored CI client secrets are not the normal path.
- **Long-running services:** one independently revocable Infisical machine identity per workload, never one identity shared by a host or fleet. Universal Auth is reserved for runtimes without federation and has finite credential lifetime, token TTL/maximum TTL/maximum uses, trusted-IP policy where reliable, and expiration alerting.
- **Local or offline human access:** Authentik is allowed only for a documented local/offline access need or a concrete Cloudflare Access incompatibility. It is not inserted into public access merely to add another identity provider.
- **Customer accounts:** product-native authentication owns customer identity, sessions, tenancy, and account lifecycle. Neither Cloudflare Access nor Authentik substitutes for product account semantics.

The versioned workload manifest fixes project, environment, path, exact secret names, authentication mode, claims, delivery mechanism, bootstrap identity, TTLs, local exceptions, and authorization tests. Production callers cannot override project/environment/path. Permission evaluation includes inherited and additive roles. Deployment fails before mutation if a reference is absent, unauthorized, outside the manifest, or backed by an incompatible identity class.

`get-secret NAME` remains the portable single-secret interface. Multi-secret services launch through a manifest-driven launcher that resolves only allowlisted names, scrubs unrelated secret-shaped parent variables, and prefers systemd credentials, orchestrator mounts, or native bindings over long-lived environment variables. Rendered Agent templates are persistent secret material: atomic restrictive creation, bounded lifetime, explicit cleanup, and leak scanning are mandatory.

Infisical Agent is not treated as an undocumented offline cache. Each local exception has a threat model, owner, expiry, revocation procedure, and denial test. Access telemetry records metadata only. Rotation admits the new version only after consumers reload successfully, retains the old version until proof, and preserves historical recovery keys for retained backup generations.

## Dependency order

1. Inventory host capabilities, workload recovery objectives, secret consumers, and existing schedulers without mutation.
2. Validate desired-state policy, destination identity, Infisical authorization scope, and offline-bootstrap exceptions.
3. Establish independent backup and recovery-package access before storage repair, pruning, key retirement, or scheduler replacement.
4. Install atomic configuration and bounded schedules on disposable fixtures, then a canary, then bounded fleet batches.
5. Prove permitted and forbidden secret reads, Loki ingestion, integrity checks, isolated restores, idempotency, rollback, and only then retire superseded material.
6. Roll out fixtures first, then one canary per runtime class, then bounded estate batches with automatic configuration rollback and no automatic destructive data rollback.

## Rollback

Managed configuration is validated, atomically installed, and retains the prior working version. Rollback restores configuration only, never live data. Existing schedules and recovery material remain until replacement restores are proven.
