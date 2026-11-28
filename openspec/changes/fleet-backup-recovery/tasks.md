# Tasks

- [x] Record proposal, design, safety boundaries, and acceptance semantics.
- [x] Add strict fleet-protection policy, plan, and observed-evidence contracts with focused tests.
- [x] Add portable read-only host/ZFS assessment and redaction tests.
- [x] Require the generated Restic writer to read an initialized repository and preview retention without deleting history.
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

### November 28 Restic writer canary

The enrolled Ubuntu controller used the generated writer with automatic
initialization and prune before the canary. While its oneshot was idle,
the two command changes from `8c4109f8` were applied atomically to
`/usr/local/sbin/restic-host-backup`, preserving owner and mode. The
installed SHA-256 was
`ee5404cb8005c193b74cdb317bccb81745facf22b054f226c1c27ad1dd03c7df`.

A manual start through the existing systemd service completed with exit
0, saved snapshot `ed74c4ea`, printed a nine-snapshot retention
preview, and reported no errors in the integrity check. The timer
remained active. Its next automatic execution was due November 28 at
04:22:04 EST. Legion's explicitly external backup owner remained in
place; Proxmox has no generated timer. No other host was changed.

For rollback diagnosis, the previous revision is retained alongside
the writer with suffix `.pre-retention-guard-20261128`. It can prune
repository history. Keep the timer disabled if that revision must
be restored while diagnosing a regression.

The Ubuntu controller then resolved the exact canary snapshot
`ed74c4ea8f409efd095466a57ba980b820540905589b1d5256e1f91c12016fbf`
through its enrolled Restic repository. A read-only, deadline-bounded
dump into root-private runtime storage restored all 1,397 bytes of
`/etc/ufw/after.rules`. The restored file matched the live file byte
for byte. The sample and temporary directory were removed before the
SSH command returned success. This verifies configuration readability
for the manual canary generation. The timer invocation and independent
credential recovery require their own checks.

- [x] Add an enrolled repository identity check to the generated Restic writer.
  The root-owned backup environment can set `RESTIC_EXPECTED_REPOSITORY_ID`
  to the full Restic configuration ID. A local Restic fixture rejected
  a readable repository with the wrong ID before creating any snapshot.
  The correct ID allowed one backup. Existing enrollments can adopt
  this setting after independently identifying their repository.

- [ ] Enroll and verify the identity guard on a production canary and
  evaluate scheduled rollout on the remaining managed writers.

The Ubuntu production canary resolved the repository configuration only
after independently finding its previously restored full snapshot ID.
It pinned the full repository ID (prefix `2bc87603c012`) in the
root-managed systemd drop-in `65-repository-identity.conf`. Its
deployed writer requires the binding and had SHA-256
`57a71b9e5ffc12fa61882f21bd50825c4c7a7cd438f5b2e60299e585b8b82735`.
A wrong-ID run failed and the complete snapshot inventory was unchanged.
The existing systemd service then exited 0 with the enrolled binding,
saved `b75c216e`, and reported no integrity errors. The timer remained
active. Automatic execution and wider rollout are pending.

For rollback, while the service is idle, restore the writer with suffix
`.pre-repository-identity-20261128`, remove only the repository identity
drop-in, and reload systemd. The retained writer still previews retention.

The repository-pinned snapshot
`b75c216ec1a549ba4101c618b49529f4234f0da25ba484d647159a59c3f8f3ed`
also passed a read-only `restic restore --verify` for the complete
`/etc/ufw` scope. All contents matched the live directory. The
12 regular files matched recorded paths, modes and ownership.
The root-private runtime directory was removed before the
SSH command returned success.

### November 28 Omen retention guard rollout

Omen had an active scheduled Restic writer with the old initialization
and prune commands. The verified Ubuntu canary command changes were
applied atomically while Omen's service was idle, retaining owner and
mode. The installed SHA-256 is
`8bcf6c1dd0911eeeeddfc1c9942621bb974af920ec934ba2ee4aeb2cc4d339a9`.
The existing timer remained active and was due at 04:15:25 EST.
Read-only inspection of the enrolled repository identified the
preceding Omen snapshot
`2f858a7767627fbcf675e221c32bd2441c47243b0bd43a9929681d3a6d8feafa`
with eight roots. The snapshot is the baseline for the next
scheduled execution and restore test. Omen's PBS timer remained
active and outside this change.

The previous Restic writer is saved with suffix
`.pre-retention-guard-20261128`. Keep the timer disabled if the
old writer must be restored for diagnosis, since it can prune history.

Omen's preceding snapshot independently restored all 1,355 bytes of
`/etc/ufw/after.rules`, matching the live file. The enrolled repository
ID starts `69d41c148862`. The active writer now requires the full ID
through the systemd drop-in `65-repository-identity.conf`. A wrong-ID
fixture on Omen failed with the snapshot inventory unchanged. The
installed writer SHA-256 is
`2cc53c6b743bc92574b3ca94eeffc72ef2d1964deb781302cc1ed6f7c519d35f`.
The timer remained active after reload, with the recalculated next run
at 04:24:52 EST. No new backup was triggered by enrollment.

Rollback uses the prior writer with suffix
`.pre-repository-identity-20261128` and removal of only the identity
drop-in while the writer is idle, followed by a systemd reload.

Omen's writer now requires all eight roots from its verified baseline.
The installed preflight rejects unreadable, wrongly mounted or empty
roots before credential lookup and backup. It checks the seven system
roots against `rpool/ROOT/ubuntu_7047hx` and the Cloudflare
configuration directory against `rpool/USERDATA/home_77obhm`.
These are Omen's observed dataset identities.

The normal host and deployed `--verify-sources` checks passed. An
isolated mount namespace put an empty temporary filesystem on
`/etc/ufw`; the candidate failed at that root, and the real mount
remained unchanged. The installed SHA-256 is
`b1a9f54555cff400ddea8aa71b0e82d361d42098c874ea186032391c7d782b3c`.
The previous pinned writer is saved with suffix
`.pre-required-sources-20261128`. The next scheduled capture must
still exercise the checks with repository credentials.

Run `bash scripts/test-restic-writer-safety.sh` to repeat the generated
writer regression test. It renders the actual hook heredoc, redirects
paths into a disposable local repository, and verifies that a missing
repository and a mismatched identity cannot create snapshots. The
correct identity must add one snapshot while preserving both prior
snapshots. The fixture passed with the local Restic CLI.

### November 28 Ubuntu controller management path

The enrolled controller's successful SSH session terminated at its
managed user-level `agent-fleet-sshd.service` on TCP 2222. A metadata-only
journal query found 246 recent `sshd` records from that unit. The existing
CrowdSec acquisition filter targets the absent system `ssh.service`
instead. Its `auth.log` acquisition reported zero parsed lines in the
same observation. The firewall bouncer was active, so the gap is SSH
event acquisition.

- [ ] Validate a narrowly scoped acquisition for the actual managed
  SSH unit. Prove original-peer attribution on the management path and
  exercise parsing and blocking without banning a shared proxy or
  interrupting management. Arm a local rollback before activating the
  policy. Keep one ban owner.

The installed CrowdSec binary accepted the candidate
`_SYSTEMD_USER_UNIT=agent-fleet-sshd.service` filter in a private mount
namespace. That filter plus `SYSLOG_IDENTIFIER=sshd` returned recent
journal records. After cleanup, the production acquisition still
contained the previous system-unit filter and both CrowdSec services
were active.

The installed parser classified a synthetic outside address as an SSH
authentication failure eligible for brute-force scenarios. It classified
the equivalent loopback event as whitelisted. Neither record entered
production acquisition. Live activation still requires independent
management access and proof that the active WARP or Tunnel path does
not attribute unrelated clients to a shared ban target.

[CrowdSec journald acquisition](https://docs.crowdsec.net/docs/log_processor/data_sources/journald/)

The Ubuntu controller now acquires the actual user SSH unit. Before
activation, fresh known-host checks verified the private route and
the independently forced Cloudflare Access fallback. OpenSSH saw a
private peer on the first path and loopback on the fallback. The
installed parser whitelisted the observed private peer and the
loopback fixture. Access therefore does not provide an original
Internet client address to this host-level ban path.

After syntax validation, the acquisition file was atomically replaced
and CrowdSec reloaded with a five-minute host-local rollback armed.
Both SSH routes succeeded again and acquisition metrics showed 32
lines read from the corrected unit. Those observed lines were
unparsed. The prior synthetic parser checks establish classification
for the authentication failure fixture. The timer was canceled only
after the path and service checks passed. UFW and the bouncer stayed
active. The installed acquisition SHA-256 is
`83fcdd9a2ea9dfc9f1ebe0d4cb84660200447f425541e69ad80b00d22cfdbdc3`.

The prior file is retained as
`/etc/crowdsec/acquis.yaml.pre-agent-fleet-sshd-20261128`.
Use atomic replacement and `systemctl reload crowdsec.service` to
restore it. A live classification and packet-drop canary remain open.

A single live authentication canary offered a disposable unknown
public key via the verified private route with host-key validation
enabled. SSH rejected it. The managed user unit logged two matching
authentication records, and CrowdSec's corrected acquisition showed
two parsed and whitelisted lines. The management peer had no decision,
a fresh authorized SSH connection succeeded, and UFW and both CrowdSec
services stayed active. The disposable key was removed. This proves
live acquisition and classification for the allowlisted route. It
does not exercise packet dropping on an external source or original
client attribution through the Cloudflare Access fallback.

A separate two-minute CrowdSec decision for documentation address
`192.0.2.174` appeared in the live Ubuntu controller nftables table
and disappeared after deletion by exact decision ID. The enrolled
SSH route and UFW remained active. A disposable veth namespace
packet-path fixture could not reach its host-side peer even before
a decision was created, so it supplied no valid packet-drop
comparison. Its interface and namespace were removed. The table
propagation test is verified; positive-control packet acceptance
and subsequent denial remain open.

### Guarded scheduled capture and restore

On November 28 at 04:24:45 EST the Ubuntu controller timer wrote
`9ff0e3d9c373e53795adf1413d1634f2ab8ddf4d7c51cbc79db8cee9a889cbbf`.
At 04:24:54 EST Omen's timer wrote
`8c9b057eed043eaae49f7433484ea950d773963873a2d8e9b967d1f2df7e938b`.
Both systemd services exited 0 and Restic reported no integrity
errors. A read-only dump of `/etc/ufw/after.rules` from each exact
generation matched the live bytes (1,397 on Ubuntu and 1,355 on Omen).
The earlier independently tested snapshots `b75c216e` and
`2f858a77` remained in their respective inventories. Both drills
removed their private temporary directories.

These two timer invocations verify repository identity enforcement,
retention preview and scheduled capture on the two enrolled hosts.
Omen additionally exercised its required-source mount check.
The historical systemd descriptions still say Prune; execution used
the confirmed preview-only writers. Other fleet hosts and independent
credential recovery remain open.

## Sanoid provisioning canary

- [x] Preserve existing Sanoid policy and detect known competing systemd snapshot timers in the workstation hook. Install Doctor revision `3a0408b6` passed the existing-policy, competing-timer, and failed-introspection fixtures.
- [x] Verify the Sanoid guard on Legion. On November 28 the live read-only branch preserved the existing configuration checksum and timer state. Separate Linux fixtures verified that a concurrently created policy survives, staging is cleaned up, and a fresh install prepares the policy and capacity guard before requesting timer activation.
- [ ] Extend live ownership checks across configured scheduler types and verify full workstation reprovisioning against a fresh canary.
- [x] Fail closed on missing or malformed ZFS capacity. Install Doctor revision `42c206be` passed threshold and unavailable-data fixtures. Legion deployed the guard as a Sanoid preflight and verified both a systemd denial fixture and a successful scheduled invocation. Deployment, invocation IDs, and rollback are recorded in [Legion's recovery runbook](https://github.com/heymegabyte/legion.megabyte.space/blob/687cd94/BACKUP-RECOVERY.md).

### Plain receive key availability

A November 28 Proxmox fixture used an unencrypted disposable source and
an AES-256-GCM receiver with an ephemeral key. The plain incremental
receive failed while the receiver's inherited key was unloaded and
created no target snapshot. With the key loaded, the exact incremental
stream succeeded, the source and receiver snapshot GUIDs matched, and
the receiver stayed unmounted. The fixture datasets and key were
removed. The planner now rejects this known-unavailable key state.
Production receiver credential custody and scheduling remain open.

A disposable November 28 native receive preserved the source snapshot
GUID but assigned a different transaction group to the received
snapshot. The Syncoid admission planner therefore compares
destination-only snapshots with the receiver-side anchor transaction
group. If the anchor is represented only by a receiver bookmark, it
cannot order destination-only snapshots and reports the divergence for
manual review. Cross-pool numeric comparisons are excluded.
