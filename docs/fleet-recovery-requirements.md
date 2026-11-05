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
| N03 | Idempotent reconciliation | Stable action keys and one scheduler per operation | Second-run live proof pending |
| N04 | Reversible configuration | OpenSpec requires atomic install/rollback | Pending implementation |
| N05 | One scheduler per operation | Duplicate schedule rejection | Fleet overlap audit pending |
| N06 | Recovery objectives | RPO/RTO required in policy; stale classification | Actual restore timing pending |
| N07 | Application consistency | Requirement recorded in OpenSpec | Pending workload inventory |
| N08 | Coverage map | Requirement recorded; explicit capabilities | Authoritative-data discovery pending |
| N09 | Mobile-host scheduling | Requirement recorded | Pending power/network adapters |
| N10 | Resource controls | Requirement recorded | Pending host-specific limits |
| N11 | Capacity protection | Automatic low-space deletion removed; alert-only guard | Alert route proof pending |
| N12 | Hardware health | SMART/NVMe/kernel evidence collector | Zen evidence captured; simulation pending |
| N13 | Power-loss handling | Requirement recorded | UPS applicability not yet discovered |
| N14 | Destination validation | Boundary, encryption, non-production target checks | Endpoint identity/capacity proof pending |
| N15 | Restricted replication identities | Requirement recorded | Denial tests pending |
| N16 | Retention dependencies | Destructive capacity pruning removed | Holds/bookmarks/clone fixture tests pending |
| N17 | Independent recovery | Independent destination required by policy | Zen has no proven independent copy |
| N18 | Separate writing from deletion | No deletion action exists in planner | Provider restriction proof pending |
| N19 | Cost controls | Requirement recorded | No new paid service enabled; estimates pending |
| N20 | Data verification | Success and verification are distinct states | Restic/PBS content checks pending |
| N21 | Restore drills | Restore-test capability and isolated-target step | Representative drills pending |
| N22 | Dependency-failure recovery | Requirement recorded | Offline drill pending |
| N23 | Encrypted recovery package | Public age recovery recipient required | Package creation/unlock proof pending |
| N24 | Root-pool recovery | Boot, partition, pool and device evidence captured | Zen replacement rehearsal/window pending |
| N25 | Credential lifecycle | Requirement recorded | Enrollment/renewal/revocation tests pending |
| N26 | Dashboards | Requirement recorded | Dashboard implementation pending |
| N27 | Actionable alerts | Capacity warning now identifies pool/impact | Routing/clear proof pending |
| N28 | Focused tests | Policy, boundary, schedule, status, secret and assessment tests | Long storage tests remain separate/pending |
| N29 | Staged rollout | OpenSpec requires fixtures/canary/batches | No rollout performed |
| N30 | Automatic maintenance | Stable reconciliation actions defined | Drift repair intentionally not deployed |

## Evidence locations

- Policy and status contracts: `packages/aid-core/src/fleet-recovery.ts`
- Focused contract tests: `packages/aid-core/test/fleet-recovery.test.mjs`
- Read-only assessment: `scripts/fleet-storage-assess.sh`
- Assessment safety tests: `scripts/test-fleet-storage-assess.sh`
- Secret fail-closed check: `scripts/test-get-secret-fail-closed.sh`
- Material-change design and remaining work: `openspec/changes/fleet-backup-recovery/`
- Zen outcome and exact blocker: `docs/operations/zen-rpool-recovery.md`
