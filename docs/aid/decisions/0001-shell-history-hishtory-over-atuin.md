# 0001 — Shell history: hiSHtory over Atuin

**Status:** accepted · **Date:** 2026-10-26 (loop fire #5) · **Type:** two-way door (reversible — flip the two `software.yml` `_deprecated` flags back) · **Deciders:** aid loop

## Context
The aid spec (`docs/aid/MASTER-PROMPT.md` §2, §13) mandates: *"Use hiSHtory instead of Atuin, with verified migration and no history deletion."* `packages/aid-core` **already enforces** this — `validateBlueprint` rejects `shellHistory: 'atuin'` with a `/hiSHtory/` error (test: "Atuin cannot be reintroduced by an old blueprint"; 52/52 green).

But the install.doctor reality **conflicted** with the contract:
- `software.yml` had **Atuin active** (no `_deprecated`) and **hiSHtory `_deprecated`** (reason: cosmetic quirks — it auto-manages `~/.bashrc`/`~/.zshrc` and `which hishtory` points at a non-existent path — the note itself conceded hiSHtory is *"superior to other history managers … but it still works"*).
- **Both entries carried AI-fabricated descriptions** (master-prompt §10 violation): hishtory `_desc` = *"browsing history analysis … online activities"*; atuin `_short` = *"managing macOS windows"*, `_desc` = *"managing AWS infrastructure … EC2 instances"*. Both are shell-history tools; the slop hid that they're the same category.

## Decision
**hiSHtory (github.com/ddworken/hishtory) is the canonical shell-history tool for the aid environment.** Atuin is **superseded**, not removed (kept as institutional knowledge per CONVERGENCE C6). `software.yml` reconciled this fire:
- hiSHtory: `_deprecated` + stale `_todo` removed (adopted); `_desc` corrected to accurate purpose with the real quirk folded in as a caveat.
- Atuin: `_short` + `_desc` corrected to accurate purpose; `_deprecated` added pointing here.

## Why hiSHtory
- **Contract + spec:** mandated by MASTER-PROMPT and enforced by aid-core (`validateBlueprint`).
- **Privacy (S19 / §13):** local-first SQLite + *optional* end-to-end-encrypted sync — no default cloud command upload; aid never sends decrypted history to cloud AI.
- The prior deprecation was over cosmetic quirks, not function — those quirks are retained as a caveat in the `_desc`, so the knowledge isn't lost.

## Alternatives considered
- **Atuin** — rejected for aid (the contract rejects it). Still present in the catalog + installable if a user opts in, but flagged superseded so provisioning surfaces it (CONVERGENCE C6 / `audit-deprecated.sh`).
- **Keep both undifferentiated** — rejected (ambiguous default; violates one-owner clarity).

## Migration (no history deletion — §13)
- Shell-history **DATA is never dropped.** Adopting hiSHtory does not delete an existing Atuin SQLite store, and vice-versa — only the `software.yml` default/preference signal changed.
- A user with existing Atuin history migrates manually (export Atuin history → import into hiSHtory); aid never auto-deletes either store.

## Consequences
- `software.yml`: hiSHtory installable + preferred; Atuin surfaced as deprecated during provisioning.
- Verified by `scripts/test-shell-history-policy.sh` (hiSHtory not `_deprecated`, Atuin `_deprecated`, no fabricated descriptions, decision record present) + aid-core's blueprint rejection test.
- **Open follow-up (not this fire):** Atuin still has `_preload: true`; installx's handling of `_preload` on a `_deprecated` entry should be reconciled separately (don't eagerly preload a superseded tool).
- **Reversible:** flip the two `_deprecated` flags to roll back.
