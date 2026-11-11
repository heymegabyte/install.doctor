# Desktop Tools upgrade and compatibility notes

Desktop Tools is the canonical product identity. Install Doctor is the repository and historical
provisioning lineage; `aid`, `aid-pair`, legacy environment prefixes, and legacy state directories are
compatibility inputs until their explicit retirement gates pass.

## Before upgrading

1. Preserve the current `ENVIRONMENT.md`, its revision and digest, the active signed release envelope,
   and the latest terminal receipt. Keep observed state separate from desired state.
2. Run `desktop-tools migrate --preview` when that compatibility command is present. Preview is not
   authorization to move or delete state.
3. Review the normalized plan, exact package closure, privilege and network effects, rollback limits,
   and any required restart. Fact drift requires a new plan.
4. Confirm that the target platform cell and exact release have current evidence. An older release,
   another architecture, or a fixture receipt cannot promote the target.
5. Keep legacy launchers and state readable until clean install, upgrade, interruption/resume,
   unchanged reapply, rollback, and deprovision preview pass for the replacement.

## Compatibility rules

- `DESKTOP_TOOLS_*` names are canonical. Supported `AID_*` and `INSTALL_DOCTOR_*` values are read-only
  compatibility inputs; new automation must not write both authorities.
- Canonical state belongs in the Desktop Tools XDG directory. Never background-move a live state
  directory or delete legacy state merely because a new directory exists.
- A profile URL is public and nonsecret. It never grants enrollment or mutation authority.
- Profile disablement, device revocation, state deletion, and evidence retention are separate actions.
- A release-channel rollback is a new forward activation of an already verified immutable release;
  do not rewrite historical release objects or erase pointer history.
- Offline resume uses the original run identity and approvals. Starting another run is not recovery.

## Current migration boundary

Production profile routing, signer custody, the complete browser-to-host canary, live Infisical
enrollment, independently tested recovery, and platform promotion remain gated. Do not remove the
compatibility surface or advertise the profile-subdomain bootstrap as generally available until those
gates have current evidence. The generated [status ledger](status.md) is authoritative for product-name
and capability migration state.

After a repository update, developers can validate local compatibility with:

```bash
npm --prefix packages/aid-core test
npm --prefix packages/installer-engine run build
node scripts/generate-desktop-tools-status.mjs --check
openspec validate desktop-tools-50-initiative-program --strict
```

These checks prove repository consistency, not a production upgrade. Follow
[`../operations/bootstrap-release.md`](../operations/bootstrap-release.md) for authorized release
operations and preserve every failed, blocked, skipped, or pending canary outcome honestly.

