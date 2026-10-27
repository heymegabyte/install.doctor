# Adoption & migration — bringing an already-configured machine under Install Doctor v2

Install Doctor is designed to adopt an EXISTING, already-set-up computer without clobbering it — not
only to provision a blank one. This is how a machine you've already configured (chezmoi, your shells,
apps installed by hand) joins v2 safely. Every step below is real behavior today; the ["Not automatic
yet"](#not-automatic-yet) section is the honest boundary.

## The adoption principle: additive, non-destructive, opt-in

Adoption never overwrites what's already there. Your existing shells, profiles, package managers, and
applications are **preserved**. v2 layers on top: it OBSERVES what you have, records desired state
**additively** through the one revisioned write path, and only changes the machine when you explicitly
run `aid apply`. Nothing is installed or removed implicitly.

## Step by step

1. **Bootstrap is idempotent — re-running is safe.** `bash <(curl -sSL https://install.doctor/start)`
   on an already-provisioned box is a no-op where state already matches; it does not re-install
   completed steps or duplicate anything (B10). chezmoi stays the single source of truth for your
   dotfiles — there is **no re-import**; the configs it already manages keep working.

2. **Enrol the existing host — fresh identity, no duplicate.** Run `aid-pair`. The machine generates a
   NEW device identity + token and enrols as itself; it never duplicates an existing host record. On a
   headless box, approve the printed code from another browser.

3. **Adopt what's already installed — it's detected, not reinstalled.** `aid plan` reconciles your
   desired packages against what's ALREADY present. Presence is resolved `_bin`-aware (a package whose
   binary differs from its name — `ripgrep`→`rg`, `angular-cli`→`ng` — still counts as present), so
   apps + CLIs you installed OUTSIDE Install Doctor are recognized and **not reinstalled** (F04). You
   see exactly what's present vs what would be added.

4. **Review before anything changes.** `aid plan` (and `aid up` = pull + plan) is READ-ONLY and records
   a `check` event to History. Review the present/missing list; nothing has mutated the machine.

5. **Apply only when you choose.** `aid apply` is **dry-run by default** (prints the plan, changes
   nothing); real installation of the missing packages is **opt-in** via `aid apply --yes` (or
   `AID_APPLY=1`). Installs run through your host package manager; existing packages are left alone.

## Why it's safe to adopt

- **Preserves your setup** — shells, profiles, package managers, and local applications are untouched;
  the command-not-found hook chains after your existing hooks and restores them on uninstall.
- **Additive desired state** — desired state is composed + versioned through the one write path; it
  never silently rewrites your local customizations, and drift is surfaced (`aid status`/`/machines`)
  rather than auto-corrected.
- **Opt-in mutation** — observed inventory + health never silently authorize changes; only an explicit
  `aid apply --yes` installs.
- **Reversible enrolment** — if you change your mind, revoke the device token (`operations.md` §
  decommission) and remove `~/.config/aid/device-token`; the machine is untouched otherwise.

## Not automatic yet

Honest boundaries — do NOT expect these:

- **No legacy-settings auto-conversion engine.** v2 does not automatically translate an arbitrary
  legacy config into the desired-state manifest (A07 is ◐). Adoption is "preserve + layer additively";
  you compose desired state deliberately, not via a magic importer.
- **Per-host private repo import is not built** (I ⬜ — see `repos-and-backups.md`). Adoption enrols
  the host + records desired state in the control plane; it does not yet create/import a per-host Git
  repo.
- **Encrypted-backup restore is not built** (J ⬜). Adoption is not a recovery/restore path.

## See also

- Getting started: `getting-started-desktop.md` · `getting-started-headless.md`.
- Operations (decommission/rollback): `operations.md`. Repo/backup model: `repos-and-backups.md`.
- Requirement matrix: `REQUIREMENTS.md` (A07 · A09 · B10 · B12 · F04).
