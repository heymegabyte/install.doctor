# Fleet backup and recovery requirement ledger

This ledger separates desired state from observed evidence. `Implemented` means repository behavior is tested; `deployed` and `verified` require host evidence and are never inferred from generated configuration.

## Earlier 30-item recommendation list

The approved IDs are `1, 5, 7, 9, 15, 16, 18–30`. The original wording and mapping are not present in the repository, saved prompt artifacts, or available conversation context. They remain **unresolved**; this project does not invent mappings or mark them complete. The named requirements in the current fleet-recovery request proceed independently.

## Current requirements

| ID | Requirement (preserved title) | Repository implementation | Host deployment / verification |
|---|---|---|---|
| A | Prioritize Zen's degraded rpool | Read-only assessment automation and repair gates | Assessed; blocked on recoverable source and SSD/maintenance decision |
| B | Sanoid, autosnap and scrubbing | Existing policy preserved; capacity deletion removed; discovered-pool timers | Zen Sanoid/scrub schedules observed; restore value unverified |
| C | Incremental replication and independent backups | Strict destination/encryption policy contract | Not deployed; no authorized destination proven |
| D | SOPS, one recovery password, and Infisical | Scoped secret references; target resolver fails closed | Recovery package/password and authorization matrix pending |
| E | Exclusions and coverage | Separate file/dataset/snapshot/replication exclusion namespaces | Per-host policies pending |
| F | Send operational and system logs to Loki | Existing Alloy plan remains configuration-only | No per-host Loki query proof yet |
| N01 | Capability inventory | Strict explicit capability manifest; read-only assessment | Zen assessed; other hosts pending live evidence |
| N02 | Validated policies | Unknown fields, unsafe destinations, and missing references rejected | Not deployed |
| N03 | Idempotent reconciliation | Durable discover/validate/plan/approve/apply/verify/status state and leases; fixture reapply tests | Second-run live proof pending |
| N04 | Reversible configuration | Atomic configuration transactions, exact validation, compensation, and separately approved reverse-dependency rollback | Live platform rollback proof pending |
| N05 | One scheduler per operation | Duplicate schedule detection plus typed lock and jitter policy | Fleet overlap audit pending |
| N06 | Recovery objectives | Coverage policy requires RPO/RTO; repository plans distinguish target, age, verification, and restore evidence | Actual restore timing pending |
| N07 | Application consistency | Workload backup admission binds database-native modes, quiesce release, source identity, and false-success denial | Workload-specific live hooks pending |
| N08 | Coverage map | Strict authoritative-data inventory and explicit protection/restore dispositions | Per-host discovery pending |
| N09 | Mobile-host scheduling | Power, connectivity, metered-network, and bounded catch-up policy tested | Live mobile-host evidence pending |
| N10 | Resource controls | CPU, memory, disk, network, I/O, concurrency, and foreground-usability guards tested | Host-specific tuning pending |
| N11 | Capacity protection | Capacity forecasts and thresholds gate work without deleting the last recovery point | Alert route proof pending |
| N12 | Hardware health | Typed CPU/memory/disk/SMART/NVMe/GPU/firmware/boot/TPM/battery/thermal/UPS inventory and exact-device fault fixtures | Zen evidence captured; fleet adapters pending |
| N13 | Power-loss handling | UPS-aware dependency shutdown/recovery planner and simulation tests | Hardware applicability and maintenance-window proof pending |
| N14 | Destination validation | Syncoid and backup admission verify host, dataset/source, capacity, mount, encryption, and production boundaries | Endpoint identity/capacity proof pending |
| N15 | Restricted replication identities | Restricted Syncoid identities and denial behavior tested in pure admission contracts | Live SSH/delegation denial proof pending |
| N16 | Retention dependencies | Holds, bookmarks, clone/resume/common-anchor dependencies and divergence refusal are represented and tested | Live retention audit pending |
| N17 | Independent recovery | Independent destination required by policy | Zen has no proven independent copy |
| N18 | Separate writing from deletion | Strict writer/maintenance identity separation and provider-limit reporting tested | Provider restriction proof pending |
| N19 | Cost controls | Disk, snapshot, backup, egress, API, telemetry, model, and restore forecasts gate sustained work | No new paid service enabled; live estimates pending |
| N20 | Data verification | Structural, rotating content, full, and client-decryption schedules have separate coverage accounting | Restic/PBS content checks pending |
| N21 | Restore drills | Restore-test capability and isolated-target step | Representative drills pending |
| N22 | Dependency-failure recovery | Requirement recorded | Offline drill pending |
| N23 | Encrypted recovery package | Public age recovery recipient required | Package creation/unlock proof pending |
| N24 | Root-pool recovery | Boot, partition, pool and device evidence captured | Zen replacement rehearsal/window pending |
| N25 | Credential lifecycle | Dual-phase credential rotation verifies consumer reload and rollback before retirement | Enrollment, host revocation, and rebuild recovery pending |
| N26 | Dashboards | Strict dashboard model covers pool/capacity/backup/replication/verification/restore states including unknown and stale | No live dashboard deployment/query proof |
| N27 | Actionable alerts | Deduplicated alert state includes host, workload/device, recovery impact, evidence, runbook, heartbeat, and clear flow | Routing proof pending |
| N28 | Focused tests | Policy, exclusion, authorization, retention, interruption, platform, and cleanup fixtures are separated from long-running checks | Long storage/recovery tests remain pending |
| N29 | Staged rollout | Cohorts, stop-on-dependent-failure, exceptions, rollback, and destructive/access exclusion are tested | No rollout performed |
| N30 | Automatic maintenance | Durable reconciliation and bounded staged drift repair contracts exist | Drift repair intentionally not deployed |

## Evidence locations

- Policy and status contracts: `packages/aid-core/src/fleet-recovery.ts`
- Focused contract tests: `packages/aid-core/test/fleet-recovery.test.mjs`
- Read-only assessment: `scripts/fleet-storage-assess.sh`
- Assessment safety tests: `scripts/test-fleet-storage-assess.sh`
- Secret fail-closed check: `scripts/test-get-secret-fail-closed.sh`
- Material-change design and remaining work: `openspec/changes/fleet-backup-recovery/`
- Zen outcome and exact blocker: `docs/operations/zen-rpool-recovery.md`
