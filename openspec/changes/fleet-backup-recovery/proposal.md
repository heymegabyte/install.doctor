# Fleet backup, storage repair, secrets, and recovery

> **Architect:** codex
> **Architect Role:** assigned

## Why

Install Doctor has useful ZFS, Restic, Rclone, secret-resolution, and Loki fragments, but no single validated host policy or evidence model proving recovery. Zen also has confirmed permanent `rpool` errors on a single SSD, making safe diagnosis and independent backup urgent.

## What changes

- Add strict, versioned fleet-protection policy and observed-evidence contracts to `aid-core`.
- Add read-only host capability and ZFS assessment that fails closed when identity, privilege, or source mounts are unavailable.
- Add safe planners for snapshot, scrub, replication, backup, recovery-package, secret authorization, and telemetry work without performing destructive storage operations.
- Make Infisical the authoritative operational secret store and keep `get-secret` as the backend-neutral caller interface; permit a protected machine-local value only for an explicitly declared offline or pre-network bootstrap dependency.
- Track every requested requirement against files, hosts, verification evidence, and blockers.
- Preserve existing schedulers and policies until a tested replacement exists.
- Implement the approved 30-item Infisical identity, authorization, delivery, recovery, telemetry, rotation, and rollout program as append-only requirements with per-workload evidence.

## Boundaries

- No pool clearing, force import/receive, detach, device overwrite, snapshot destruction, or automatic rollback.
- No secret values in Git, logs, process arguments, reports, or model-visible output.
- No routine age/SOPS secret store, controller-store fallback, or caller-selected secret scope. Offline bootstrap material is machine-scoped, auditable, and unavailable after its declared bootstrap boundary.
- Generated plans and configuration are not evidence of successful backup, ingestion, repair, or restore.
- Live application and host mutation requires a validated target, policy, prerequisite evidence, and authorized bounded rollout.
- Secret management does not replace user authentication: public human access uses Cloudflare Access, CI/platform automation uses native OIDC, services use scoped Infisical machine identities, local/offline human access may use Authentik only when documented, and customer accounts remain product-native.
