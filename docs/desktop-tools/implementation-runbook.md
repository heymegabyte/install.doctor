# Desktop Tools implementation and verification runbook

This runbook describes repository behavior that can be verified from the current checkout. It does
not promote a platform, activate a release, enroll a production host, provision credentials, or
prove that an external service is healthy. The generated [capability status](status.md) and the
signed platform matrix remain authoritative when a narrower test and a published capability claim
differ.

Use these evidence states consistently:

- **repository-verified**: implementation and focused tests pass in this checkout;
- **fixture-verified**: a disposable or pure fixture exercises the boundary, but not a real host;
- **unverified**: implementation exists without the required external evidence;
- **blocked**: a named prerequisite such as production authority, approved design, or authorized
  hardware is absent.

Never promote fixture output to `verified-live`. A generated configuration, accepted plan, started
service, or successful structural test is not a completed host lifecycle.

## Safe local verification

Install package dependencies through the repository lockfiles, then run the bounded suites from the
repository root:

```bash
npm --prefix packages/aid-core install
npm --prefix packages/aid-core test
npm --prefix packages/installer-engine install
npm --prefix packages/installer-engine run build
node --test \
  packages/installer-engine/test/qubes-fixture-contract.test.mjs \
  packages/installer-engine/test/qubes-native-lifecycle.test.mjs \
  packages/installer-engine/test/proxmox-fixture-contract.test.mjs \
  packages/installer-engine/test/proxmox-lifecycle.test.mjs \
  packages/installer-engine/test/wsl-boundary.test.mjs \
  packages/installer-engine/test/immutable-linux-deployment.test.mjs
openspec validate desktop-tools-50-initiative-program --strict
```

These commands may establish repository or fixture evidence only. They do not mutate Qubes, Proxmox,
Windows, WSL, an OSTree host, Cloudflare, Infisical, or a production release channel.

## Operator truth table

| Area | Current local evidence | Operator boundary |
| --- | --- | --- |
| Release bootstrap | Signed-release, activation, expiry, revocation, and rollback contracts have repository tests. | Production signer custody, protected identities, immutable buckets, channel activation, and public canaries remain external gates. Run `task desktop-tools:production-readiness`; treat `BLOCKED` as a valid result. |
| Installer transactions | The engine verifies typed DAG execution, journals, leases, resume, configuration rollback, renderer parity, and selected migrated effects. | Only effects represented by admitted typed operations are engine-owned. Do not subtract a legacy writer without its parity and subtraction evidence. |
| Offline execution | Linux Bubblewrap execution requires signed host facts, an exact approved bundle and plan, a denied network namespace, and the same run identity for resume. | It is not a provider fallback and accepts no model, endpoint, or recovery prompt. Unsupported hosts fail before mutation. |
| Secrets | Strict identity, offline-exception, authorization-simulation, and rotation contracts exist. | Infisical subscription discovery, canary enrollment, permitted/denied live reads, renewal, and revocation are not established by unit tests. Never introduce a controller-store fallback. |
| Recovery | Coverage, ZFS planning, Syncoid admission, backup admission, authority separation, and verification scheduling are repository-verified. | An independently held encrypted recovery package and representative source-unavailable restores remain unverified. Follow the Zen runbook rather than inferring a disk repair from software checks. |
| Extensions | Signed manifest admission, compatibility, permissions, disablement, revocation, and one read-only fixture extension are repository-verified. | Arbitrary npm installation is not an extension publication path. A production catalog needs its own signer, publication, and revocation evidence. |
| Sessions and renderers | Durable coordination, resumable transport, encrypted output-only recordings, renderer parity, and multi-agent TUI behavior have focused tests. | No test creates a public browser terminal or proves a production relay. Visual SaaS work remains gated on explicit Figma approval. |
| Platforms | Linux, Windows-contract, WSL, Proxmox, Qubes, immutable-Linux, device-posture, and UPS fixtures exercise bounded semantics. | The platform support matrix remains unpublished/unsupported until fresh independent full-lifecycle receipts exist for the exact tuple and release. |

## Offline bundle operations

Offline execution is intentionally plan-first and two-step:

1. Inspect and verify the signed bundle and exact target binding.
2. Materialize with `offline: true` and `networkPolicy: "deny"`.
3. Execute with exact manifest and plan approvals.
4. After interruption, resume the same `runId`; never start a fresh run over abandoned evidence.
5. Preserve the terminal receipt and journal. An exit code alone is not completion evidence.

The strict CLI accepts an absolute invocation file:

```bash
node packages/installer-engine/dist/install-doctor-engine.mjs \
  --input /absolute/path/to/invocation.json
```

Construct invocation files from the versioned schemas and tests; do not copy an illustrative payload
from documentation. `bundle-execute` and `bundle-resume` reject caller-selected clocks, providers,
inference inputs, surplus artifacts, wrong-host material, and unsafe local execution environments.

## Repair and rollback

- Configuration rollback is separately planned and approved from committed source-run evidence.
- Automatic rollback does not include packages, operating systems, networks, storage, or external
  services. Those classes require their own explicit procedure and authority.
- A resumed run must match the original plan, host facts, release, locks, and journal identity.
- Deprovision is preview-only unless a separate admitted implementation says otherwise; user-owned,
  modified, unsupported, and unowned resources are preserved.
- For Zen, use [`docs/operations/zen-rpool-recovery.md`](/docs/operations/zen-rpool-recovery). Do not
  clear errors, force-import, detach, replace, or recreate the pool from generic automation.

## Platform fixtures

### Qubes

The strict fixture models dom0, TemplateVM, AppVM, DisposableVM, Whonix Gateway, Whonix Workstation,
and exact qrexec routes. Native fixture operations expose typed services and payload digests—not a
generic command or shell field. Tests require source/rule/target authority intersection, offline
network denial, unchanged persistent reapply, and DisposableVM teardown. This is fixture evidence;
the public Qubes bootstrap remains unpublished.

### Proxmox

The fixture covers repositories, host configuration, VM/LXC metadata, guest agents, backup, network
intent, upgrade, and maintenance boundaries. It cannot invent production ingress, storage topology,
guest identity, or maintenance authority. A real canary remains required.

### WSL and Windows

WSL host and guest identities are distinct. Cross-boundary paths, credentials, reboot, and service
authority fail closed unless explicitly represented. Windows-native operation schemas and a disposable
fixture do not publish or qualify the PowerShell bootstrap on a real Windows host.

### Immutable Linux

The immutable planner binds OSTree deployment checksums, exact layered-package NEVRAs, Flatpak commits
and scope, reboot admission, and rollback targets. Its disposable OSTree observation does not qualify
a physical Silverblue or bootc system.

## Extension development

An extension must have an immutable signed manifest, compatible host/runtime range, bounded
capabilities, isolated lifecycle hooks, provenance, and revocation state. Admission intersects the
manifest request with host policy; a manifest cannot broaden host authority. Keep privileged mutation
behind typed engine operations and verify denial as well as success. Do not add postinstall scripts,
runtime dependency fetching, or a public unrestricted shell as a shortcut.

Focused verification:

```bash
npm --prefix packages/aid-core run build
node --test packages/aid-core/test/extension-admission.test.mjs
```

## Evidence to retain

For any external canary retain the exact profile revision, release and recipe digests, target identity,
plan digest, approvals, journal identity, postconditions, terminal receipt, independent attestation,
timestamps, and expiry. Record `PASS`, `FAIL`, `SKIP`, `BLOCKED`, and `UNVERIFIED` distinctly. Redact
secret values at their source; a report containing credentials is invalid evidence, not a successful
diagnostic.

