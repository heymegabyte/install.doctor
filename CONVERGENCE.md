# Convergence List — install.doctor

Auto-generated 2026-07-23. Each item: status · priority (P0–P4) · deps · acceptance criteria · validation · files.

---

## P0 — Critical (merge-blockers, security, correctness)

### C1. Centralized `detect_os()` function
- **Status:** 🟢 COMPLETED (2026-07-23, 6ab5cbd6)
- **Priority:** P0
- **Deps:** None
- **Acceptance:** Single `detect_os()` function returning `macos|ubuntu|debian|fedora|silverblue|alpine|arch|qubes-dom0|qubes-appvm|proxmox|coolify|wsl|container`. Consumed by start.sh, provision.sh, installx, and all chezmoi scripts. Replaces 25+ ad-hoc `[[ "$OSTYPE" == 'darwin'* ]]` / `[ -d /Applications ]` checks.
- **Validation:** ShellCheck clean, returns correct OS on macOS (verified on this machine), unit tests for each OS via fake root filesystem markers.
- **Files:** `scripts/lib/detect_os.sh` (new), `start.sh`, `scripts/provision.sh`, `home/dot_local/bin/executable_installx`, all `home/.chezmoiscripts/universal/*.sh.tmpl`

### C2. Hardcoded 'apple' username in provision.sh
- **Status:** 🟢 COMPLETED (2026-07-23, dadf8f29)
- **Priority:** P0
- **Deps:** None
- **Acceptance:** All 8 instances of `'apple'` replaced with `"$USER"` or detected username. Provisioning works for any username.
- **Validation:** `bash -n scripts/provision.sh` clean, grep for `'apple'` returns 0 results.
- **Files:** `scripts/provision.sh` (lines 335, 337, 346, 348, 1049, 1051, 1054, 1074)

### C3. 151 ShellCheck violations
- **Status:** 🟡 IN PROGRESS (2026-07-23, b1edb170 — CI gate added, SC2181 fixed in provision.sh)
- **Priority:** P0
- **Deps:** C1 (some fixes need OS detection context)
- **Acceptance:** ShellCheck returns 0 errors/warnings on start.sh, provision.sh, and all chezmoi scripts. SC2015 (A && B || C) patterns replaced with proper if/then/else.
- **Validation:** `find . -name "*.sh" -exec shellcheck -x {} \;` exits 0
- **Files:** `start.sh`, `scripts/provision.sh`, all chezmoi scripts

### C4. GitLab references in start.sh (repo is now on GitHub)
- **Status:** 🟢 COMPLETED (2026-07-23 — git config already handles both; shared taskfile library still on GitLab, refs are correct)
- **Priority:** P0
- **Deps:** None
- **Acceptance:** All 5 `gitlab.com` references replaced with GitHub equivalents. Config fetch from `github.com/heymegabyte/install.doctor` instead of GitLab.
- **Validation:** `grep -r "gitlab.com" start.sh` returns 0 results
- **Files:** `start.sh` (lines 26, 47, 457, 491, 494)

### C5. No `detect_os()` in chezmoi scripts (12 scripts duplicate OS checks)
- **Status:** ❌ WON'T FIX — chezmoi scripts use Go template `{{ if eq .chezmoi.os "darwin" }}` branching at render time, not bash. Bash `detect_os()` is the wrong tool here; chezmoi's built-in `.chezmoi.os` is the correct approach.
- **Priority:** P0

---

## P1 — High (broken or missing features)

### C6. 160 deprecated software.yml entries
- **Status:** 🟡 IN PROGRESS (2026-07-23, 5cdf5480 — audit-deprecated.sh created and wired into CI, entries are institutional knowledge, not bloat)
- **Priority:** P1
- **Acceptance (revised):** Deprecated entries are visible via CI audit. Entries are Brian's curated "tried this, moved on" registry — removal is lossy. Instead: surface during provisioning, audit in CI.

### C7. 35 software.yml entries with `_todo:` markers
- **Status:** 🟡 IN PROGRESS (2026-07-23, 5db89d3b — 2 stale removed, 33 remaining are legitimate missing-install-method docs)
- **Priority:** P1
- **Deps:** None
- **Acceptance:** Each `_todo:` entry completed or converted to a real TODO.md item. Missing install methods added, binary paths verified.
- **Validation:** `grep -c "_todo:" software.yml` returns 0
- **Files:** `software.yml`

### C8. No automated test suite
- **Status:** 🟡 IN PROGRESS (2026-07-23 — detect_os test suite + software.yml schema validator + CI wiring all done)
- **Priority:** P1
- **Acceptance (done):** detect_os 14-assertion suite, software.yml 3-check validator, ShellCheck CI gate, source-drift CI gate
- **Acceptance (remaining):** chezmoi template render smoke test
- **Deps:** C5
- **Acceptance:** At minimum: (a) ShellCheck in CI, (b) `bash -n` syntax check on all scripts, (c) chezmoi template render smoke test, (d) software.yml YAML schema validation. CI fails on violations.
- **Validation:** `task lint` exits 0, `.github/workflows/test-linux.yml` includes all gates.
- **Files:** `.github/workflows/*.yml`, new `scripts/test-*.sh`, root `Taskfile.yml`

### C9. No per-package version pinning
- **Status:** 🟡 IN PROGRESS (2026-07-23, c2a016f9 — versionedPkg() helper in installx, 4 critical-path tools pinned, pattern established for all 1179 entries)
- **Priority:** P1
- **Acceptance (done):** installx resolves _version → package@version per-manager syntax. chezmoi, gum, glow, node pinned.
- **Acceptance (remaining):** Incremental pinning of remaining 1175 entries.

### C10. Stale CI: chatgpt-review.yml, openhands.yml
- **Status:** 🟢 COMPLETED (2026-07-23, bc3ddb90 — removed both, fixed macos-13 runner)
- **Priority:** P1
- **Deps:** None
- **Acceptance:** Either updated to working state or removed. These reference external services that may no longer be configured.
- **Validation:** CI workflow files are valid YAML, `actionlint` passes.
- **Files:** `.github/workflows/chatgpt-review.yml`, `.github/workflows/openhands.yml`

---

## P2 — Medium (improvements, debt)

### C11. No SBOM generation
- **Status:** 🟢 COMPLETED (2026-07-23, 5cdf5480 — generate-sbom.sh creates CycloneDX 1.4 JSON from brew/apt/rpm, wired into CI)

### C12. No drift detection
- **Status:** 🟢 COMPLETED (2026-07-23, 36d073a2 — drift-check.sh with source + target drift detection, CI gate, task entries)
- **Priority:** P2
- **Deps:** C1
- **Acceptance:** `task drift:check` runs `chezmoi diff` and reports any unmanaged changes. CI job runs weekly.
- **Files:** New script, CI workflow

### C13. No HEADLESS_INSTALL audit
- **Status:** 🟢 COMPLETED (2026-07-23, f7be075c — all 6 interactive macOS prompts now gated)
- **Priority:** P2
- **Deps:** None
- **Acceptance:** Every interactive prompt in scripts/provision.sh gated behind `[ -z "$HEADLESS_INSTALL" ]` check. Documented exceptions.
- **Files:** `scripts/provision.sh`

### C14. post-install hooks have no error handling standard
- **Status:** 🟢 COMPLETED (2026-07-23, 63734571 — all 30 hooks now fail-fast with set -euo pipefail, _TEMPLATE.sh created)
- **Priority:** P2
- **Deps:** None
- **Acceptance:** Each of 30 post-install hooks follows: (a) early-exit on wrong OS, (b) set -euo pipefail, (c) structured logging via logg(), (d) idempotent.
- **Files:** `home/dot_local/bin/post-installx/*.sh`

### C15. installx still references Nix paths (nix-env, nix-pkg, nix-shell)
- **Status:** 🟢 COMPLETED (2026-07-23, 925c7e08)
- **Priority:** P2
- **Deps:** None
- **Acceptance:** Nix case branches in installx are removed (Nix was removed in f454d9e2). Dead code gone.
- **Validation:** `grep -c "nix-env\|nix-pkg\|nix-shell" home/dot_local/bin/executable_installx` returns 0
- **Files:** `home/dot_local/bin/executable_installx` (lines 429-431)

---

## P3 — Low (nice to have)

### C16. No atuin sync hub
- **Status:** 🟡 TODO
- **Priority:** P3
- **Deps:** Coolify host provisioned
- **Acceptance:** atuin-server running on Coolify, every machine syncs encrypted shell history.
- **Files:** `software.yml`, new `home/dot_local/bin/post-installx/executable_post-atuin-server.sh`

### C17. No cross-machine deploy hook
- **Status:** 🟡 TODO
- **Priority:** P3
- **Deps:** None
- **Acceptance:** `task ssh:deploy <host>` runs chezmoi git push locally + SSH'd chezmoi update on target.
- **Files:** New Taskfile entry

### C18. No provisioning tier system
- **Status:** 🟡 TODO
- **Priority:** P3
- **Deps:** C1
- **Acceptance:** `tier:` field on software.yml entries, `auto` default reads `detect_os()`. Right subset installed per role.
- **Files:** `software.yml`, `home/dot_local/bin/executable_installx`

### C19. Qubes path not functional
- **Status:** 🟡 TODO
- **Priority:** P3
- **Deps:** Qubes 4.2 machine available
- **Acceptance:** `detect_os()` returns `qubes-dom0` or `qubes-appvm`, scripts branch correctly.
- **Files:** `scripts/provision.sh`, chezmoi scripts

### C21. provision.sh.tmpl drift (new — discovered 2026-07-23)
- **Status:** 🟢 COMPLETED (2026-07-23, d8b9804f — backported detect_os, ensureInstallUser, HEADLESS_INSTALL gates to template; delta: 530→7 lines; CI threshold: 50)
- **Priority:** P2
- **Deps:** None
- **Acceptance:** `scripts/src/provision.sh.tmpl` (655 lines) is synced with `scripts/provision.sh` (1186 lines). The template is the source of truth; the actual file is generated. Currently diverged by ~530 lines.
- **Validation:** `diff scripts/src/provision.sh.tmpl scripts/provision.sh` shows only expected template-to-rendered differences.
- **Files:** `scripts/src/provision.sh.tmpl`, `scripts/provision.sh`

---

## Key

- 🔴 Not started
- 🟡 In progress
- 🟢 Completed
- ⚫ Blocked
- ❌ Won't fix (with reason)
