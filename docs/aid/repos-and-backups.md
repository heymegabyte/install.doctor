# Per-host repositories & encrypted backups — the responsibility model

How Install Doctor intends to store a host's configuration and recover its data. This document is the
**contract** every future piece of the per-host-repo (category I) and backup/disaster-recovery
(category J) work must be built against — especially the security boundary of what may and may not
enter Git.

> ## ⚠️ Status: DESIGNED — not yet built
>
> This is the intended model, **not** shipping behavior. Today Install Doctor has host **identity**
> (an enrolled device has a stable id + token; see `docs/aid/decisions/0002`) but it does **not** yet
> create per-host Git repositories, take sanitized snapshots, run encrypted backups, or perform
> restores. Do not expect any of the repo/backup behavior below to work end-to-end yet — it is the
> spec the implementation will converge to. The honest live-vs-blocked status lives in `REQUIREMENTS.md`
> (categories **I** and **J** are ⬜).

## Two stores, two jobs

Install Doctor separates a host's state into two stores with different sizes, cadences, and trust rules:

- **A private Git repository** — small, curated, human-reviewable **configuration + metadata**. One
  per host. Committed often; the source of truth for desired state and recovery pointers.
- **Encrypted backup storage** — large, opaque **bulk data** (user files, databases, application
  state). Never in Git; written by encrypted backup tooling to private object storage.

The rule of thumb: *if a human would want to read or diff it, it belongs in Git; if it is bulk or
sensitive binary data, it belongs in an encrypted backup.*

## Per-host Git repository (category I)

- **One private repository per enrolled host.** Private by default; its remote ownership + privacy is
  verified before the first push.
- **Identity is an immutable host UUID, not the hostname.** Repos use the existing FQDN-based naming
  where appropriate, but the durable key is an opaque **host UUID** so a rename/re-IP never forks a
  host's history. Known existing repositories are reused, never duplicated.
- **What Git stores** (curated, allowlisted from a dedicated state directory):
  - the schema-validated desired-state manifest + the generated `ENVIRONMENT.md` revision,
  - **sanitized** inventory snapshots (observed state with secrets + personal data stripped),
  - lockfiles + pinned recipe revisions,
  - recovery metadata: backup **policies**, snapshot **ids**, health **refs**,
  - provenance: job ids, plan revisions, actor, verification refs.
- **What Git must NEVER store** (disabled at the source, not merely redacted later):
  - **secret VALUES** — only scoped secret *references* (Infisical / Bitwarden) may appear in config;
    the values never enter Git, model context, recordings, or generic logs,
  - browser sessions, private keys, shell histories, terminal recordings, raw environment dumps,
  - user bulk data (that is the backup store's job).
- A commit is scanned for secrets + forbidden data **before** it syncs; writes are serialized and
  meaningless inventory churn is debounced. Repo credentials are narrowly scoped + short-lived, and a
  host is **never** given the control plane's GitHub App private key.

## Encrypted backups & disaster recovery (category J)

- **Coverage is explicit per class:** configuration, user data, applications, databases — each stated,
  not assumed.
- **Encrypted tooling (restic)** writes to private **S3-compatible** storage. Backup credentials are
  scoped to the host/tenant; the authority to **back up** is separate from the authority to **delete**.
- **Decryption keys have independent recovery** — losing the host does not lose the ability to restore.
- Only **policies / snapshot ids / health refs** live in Git; the encrypted data itself never does.
- Databases get **app-consistent** exports/snapshots; ownership, permissions, and platform metadata are
  preserved on restore.
- **Restore is distinct from device identity:** a replacement host restores approved config + data
  **without** cloning the old host's device credentials (it enrolls fresh).
- Three different operations are never conflated: **config rollback**, **package rollback**, **data
  restore**.
- **Freshness is shown honestly:** **backup age** and **last verified restore** are displayed
  separately — a recent backup that has never been test-restored is not "safe."

## The secret boundary (why the split is load-bearing)

Secret **values** are authoritative in **Infisical Cloud** (machine/app secrets) and **Bitwarden**
(selected interactive credentials). Configuration in Git may reference them by scoped key; it may not
contain them. This is enforced at the source — sensitive capture is disabled where it originates, not
scrubbed after the fact — because a redaction pass that misses one value has already leaked it into
history. The same discipline keeps recordings, logs, and model context free of secret values.

## What exists today vs what is designed

- **Exists:** host identity (enrolled device id + revocable scoped token, `decisions/0002`); the
  desired-state manifest + `ENVIRONMENT.md` revision + a stale-plan guard (`revision_mismatch`); History.
- **Designed, not built:** per-host repo creation + first-push verification, the sanitized-snapshot
  staging directory + pre-sync secret scan, restic encrypted backups, restore + replacement-host drills,
  the backup-age / last-verified-restore surface.

## See also

- Architecture invariants: the project `CLAUDE.md` and `MASTER-PROMPT.md` §3.
- Requirement matrix (I + J rows, status ⬜): `REQUIREMENTS.md`.
- Getting started: `getting-started-desktop.md`, `getting-started-headless.md`.
- Device identity decision: `decisions/0002`.
