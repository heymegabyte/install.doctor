# Upstream provenance & license obligations

What Install Doctor is built from, where each piece comes from, and the license that governs it —
honest about what is actually vendored vs merely a candidate. Verify a license at its source before
any redistribution; where this doc isn't certain it says so rather than guess.

## Install Doctor itself

- **install.doctor** — this repo. License: **MIT** (root `package.json` `"license": "MIT"`). The repo
  is public; every committed secret ships age-encrypted (see `CLAUDE.md` §3).
- **software.yml** — the project's OWN authoritative catalog (1000+ entries). Not an upstream; it's
  original project data that references upstream package managers.

## Provisioning machinery (preserved foundations)

These are invoked as tools, not vendored into this repo's source — each stays under its own upstream
license (confirm at the source before redistributing):

- **chezmoi** (`twpayne/chezmoi`) — dotfile manager; the single source of truth for configs. MIT.
- **mise** (`jdx/mise`) — runtime/tool version manager; used where it reduces custom lazy-install code. MIT.
- **hiSHtory** (`ddworken/hishtory`) — the preferred shell-history tool (Apache-2.0 upstream; verify
  before redistribution).
- **installx** (`home/dot_local/bin/executable_installx`) — the project's own ZX-based installer (MIT,
  part of this repo).

## Control plane + contracts (`packages/`)

Runtime dependencies, all permissively licensed (verified from the manifests this session):

- **Hono** `^4.13.14` — the Worker HTTP framework (`packages/control-plane`). **MIT**.
- **Zod** `^4.6.7` — schema validation at every boundary (control-plane + aid-core contracts). **MIT**.
- **Wrangler** — the Cloudflare deploy CLI; invoked via `npx` (not a pinned dep). Dual **MIT OR
  Apache-2.0** (Cloudflare; verify at the pinned version).
- **packages/aid-core** — the project's OWN shared TypeScript contracts (`Blueprint`, `ROUTES`,
  `chooseRoute`, session/Loki schemas). Zero runtime deps; part of this repo.

## The `aid` runtime (K01 — intended upstream, NOT yet forked)

- **Intended upstream:** **OpenCode** (`sst/opencode`) — the plan is for `aid` to be a minimal,
  maintained OpenCode-DERIVED agent with a documented patch queue (K01/K02).
- **Honest status:** this is **not yet built**. Today `aid` is a POSIX-sh **shell client**
  (`home/dot_local/bin/executable_aid`) that talks to the control plane — there is **no OpenCode fork
  in this repo**. K01 is remaining (see `REQUIREMENTS.md` K). When the fork lands it carries OpenCode's
  upstream license + a patch-queue record here.

## Upstream CANDIDATES (`UPSTREAMS.lock.json`) — evaluated, none vendored

`UPSTREAMS.lock.json` records **30** upstream projects under evaluation for future reuse across the
estate — e.g. `microsoft/PowerToys`, `louislam/uptime-kuma`, `ansible/ansible`, `coollabsio/coolify`,
`restic/restic`, `gitleaks/gitleaks`. Honest status:

- **All 30 are `disposition: pending-evaluation`** — candidates, **none vendored** into this repo yet.
- Each entry carries `repo` · `intendedContribution` · `boundary` · `pinnedCommit` · `filesReused` · a
  `license` field that is currently **`null` (not yet recorded)**. Before any code is reused from a
  candidate, its license + boundary must be filled in and honored (AGPL/GPL isolation via an HTTP
  boundary where required).
- The lock is the single source of truth for this list; this doc summarizes it and must not drift from
  it (the X09 gate cross-checks the count).

## Obligations summary

- This repo's own code: **MIT** — attribution preserved.
- Invoked tools (chezmoi, mise, hiSHtory, wrangler): used as tools under their own licenses; no source
  vendored, so no redistribution obligation is triggered by this repo.
- Bundled runtime deps (Hono, Zod): MIT — no copyleft.
- OpenCode + the 30 candidates: **no obligation yet** — nothing vendored. Record + honor each license
  at the moment of reuse.

## See also

- Candidate lock: `UPSTREAMS.lock.json`. Requirement matrix: `REQUIREMENTS.md` (K · S).
- Operations: `operations.md`. Platform support: `platform-support.md`. API: `api-reference.md`.
