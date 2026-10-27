# Operations — troubleshooting, rollback, decommission

The real recovery paths for Install Doctor v2 as it ships today. Every command + endpoint below is
live; the ["Not built yet"](#not-built-yet) section is the honest boundary.

## Troubleshooting (host side — `aid`)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `aid status` → "not paired — run: aid-pair" | No device token at `~/.config/aid/device-token`. | Run **`aid-pair`** (desktop opens the approval page; headless prints a code + URL to approve from another browser). |
| `aid status` → "token not recognized (revoked or unknown) — re-pair" | The device token was revoked (or the tenant/DB changed). | Run **`aid-pair`** again — the machine claims a NEW token; the old one stays revoked. |
| `aid status` → "desired state: NOT authorized — lacks '…'" | The device token's granted scope is too narrow (P05 enforcement). | Re-pair to widen scope (`aid-pair`), or enroll with the needed permissions. |
| `aid plan` / `aid up` can't reach the control plane | Offline / control-plane unreachable. | **`aid plan` still works offline** — it reconciles against the last-pulled `ENVIRONMENT.md` locally (S23). Re-run `aid up` when connectivity returns. |
| Machine is behind the desired revision (drift) | Desired state advanced; this host hasn't applied it. | **`aid up`** (pull + reconcile), then **`aid apply --yes`** to install the missing packages via the host package manager. |
| `apply` → `409 revision_mismatch` | The plan was computed against a stale desired revision (§3 / P09 guard). | Re-pull: **`aid up`** (or `aid pull`), then retry — execution must match the plan's expected revision. |
| An unknown command does nothing special | Not in the catalog / denied. | Ordinary `127` not-found behavior (E14). For an AUTHORIZED install use **`aid exec <cmd>`** (install-then-run) or **`aid prewarm <cmd>`** (install only). |
| A missing command didn't auto-install in CI | Unattended install-on-miss is OFF by default. | Opt in deliberately: `CNF_ALLOW_NONINTERACTIVE=1`, or use `aid exec`/`aid prewarm` (the authorized unattended path). |

## Rollback (control plane — app.install.doctor)

- **Worker rollback** — roll the control-plane Worker to a prior deploy:
  `wrangler rollback <version-id>` (list versions in the Cloudflare dashboard or `wrangler deployments list`).
  Every fire records its deployed version id, so the rollback target is known.
- **D1 Time Travel** — the desired-state DB (`aid-control-plane`) supports 30-day point-in-time
  recovery: `wrangler d1 time-travel restore aid-control-plane --timestamp <ISO>` (or `--bookmark`).
- **Desired-state revision rollback** — desired state is content-addressed by `revision`; to revert a
  tenant to an earlier plan, `PUT /api/environment/current` the prior blueprint through the ONE
  validated write path (the optimistic `expectedRevision` lock prevents a lost update). Observed
  inventory/History are never mutated by a rollback.

## Host decommission

Retiring a machine is a revoke, not a delete — other hosts are untouched (P15):

1. **Revoke the device token** (admin): `POST /api/devices/:id/revoke`. The token is **immediately
   401-rejected** on every device endpoint (`/api/device/*`, `/api/devices/me`) — verified live
   (S27 + the W08 isolation test). The device shows `revoked` on `/machines`.
2. **Local cleanup** on the host: remove the stored token — `rm -f ~/.config/aid/device-token` — and,
   if desired, the pulled `~/.config/aid/ENVIRONMENT.md`.
3. **History is retained** — the decommissioned device's past events stay in the tenant History for
   audit; revoking does not erase them.
4. Re-enrolling later is a fresh `aid-pair` (a new identity + token); it never reuses the revoked one.

## Not built yet

Be honest — these recovery capabilities are DESIGNED, not shipping (see `repos-and-backups.md`,
`REQUIREMENTS.md` I/J):

- **Encrypted-backup restore + replacement-host restore drills** — the restic→S3 backup/restore path
  (category J) is `⬜` not built; do not rely on a "restore my data to a new machine" flow yet.
- **Server-pushed apply** — the control plane never installs on your machine; `/api/device/apply`
  real mutation returns `501`. Installs happen locally via `aid apply --yes`.
- **Per-host private repo recovery** — category I is `⬜` (the repo/backup contract is in
  `repos-and-backups.md`).

## See also

- Getting started: `getting-started-desktop.md` · `getting-started-headless.md`.
- Platform support: `platform-support.md`. Repo/backup model: `repos-and-backups.md`.
- API: `api-reference.md`. Requirement matrix: `REQUIREMENTS.md`.
