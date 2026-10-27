# ADR 0003 — mise lazy-tools: coexist, defer to mise, don't duplicate its machinery

- **Status:** accepted (fire #47, 2026-10-26)
- **Requirement:** E02 — "Evaluate pinned mise lazy-tools support before building equivalents"; §3 — "Use
  mise where it reduces custom runtime and lazy-installation code."

## Context

The repo ships a custom command-not-found (cnf) lazy-installer
(`home/dot_config/shell/not-found-hook.sh`) that, on a missing command, looks the binary up in an index
built from `software.yml` and installs it via the OS package manager (brew/apt/dnf/…). The estate also
uses **mise** (`mise` 2026.10.x; the tool formerly named `rtx`) for version-managed runtimes, activated
in each shell (`mise activate`). The question (E02): does mise already provide "lazy tools" we'd be
duplicating, and where is the boundary?

### What mise actually does (evaluated against mise 2026.10.4)

- mise manages **version-pinned runtimes + tools** declared in `mise.toml`/`config.toml` and exposes them
  as **shims** (or via `mise activate`'s PATH). For a *configured* tool, the command is ON PATH, so
  command-not-found **never fires** — mise's "lazy" is really *activation*, not install-on-miss.
- mise has **no generic install-on-command-not-found** hook. There is no "type any unknown command and
  mise installs it" behavior; mise only provides tools it's been told about (`mise use`/`mise.toml`) or
  run explicitly (`mise exec -- <tool>`). `mise which <cmd>` resolves **only** a tool mise manages.
- The E-note caveat holds: disabling mise's generic auto-install setting does **not** disable explicitly
  lazy `mise.toml` declarations — but those are activation-time, not command-not-found-time, so they don't
  collide with the cnf hook's miss path.

## Decision

1. **Keep the cnf hook as the command-not-found lazy-installer for non-mise tools.** mise does not cover
   this surface (arbitrary CLI typed but not installed), so the hook is not a duplicate of mise.
2. **Defer to mise for tools mise already provides.** Before the cnf hook installs via a system package
   manager, if `mise` is present and `mise which "$cmd"` succeeds (the tool IS mise-managed, just not on
   this shell's PATH), the hook runs the command **via `mise exec`** and returns its status — it does
   **not** redundantly install a second copy via brew. This is the "use mise where it reduces
   lazy-install code" directive made concrete, and prevents two package managers owning one runtime.
3. **Do not duplicate mise's version-management machinery.** The cnf hook does not pin versions or manage
   runtimes; that is mise's job. The hook installs a working binary for one-off CLIs; mise owns
   version-managed runtimes declared in config.

## Consequences

- A command mise manages (e.g. a runtime installed via `mise use`) that isn't on PATH in the current
  shell now *works* on first type (runs via `mise exec`) instead of triggering a redundant brew install.
- The defer is scoped to the **normal exec path** — the install-only `CNF_NO_EXEC` callers (`aid exec`,
  `aid prewarm`, the fish/pwsh adapters) and `CNF_DRY` skip it, so their contracts are unchanged.
- mise's stderr (it can emit deprecation warnings) is muted in the probe (`2>&1`) so a cnf miss stays
  quiet when mise is present but doesn't manage the command.
- Tested hermetically with a fake `mise` + fake `brew` (`scripts/test-command-not-found.sh`): a
  mise-provided command runs via mise (status preserved) and brew is never invoked; a non-mise command
  falls through to the normal install path. RED→GREEN, 23/23.

## Alternatives considered

- **Replace the cnf hook with mise entirely** — rejected: mise has no install-on-command-not-found, so
  arbitrary missing CLIs would just error. The hook covers a surface mise does not.
- **Install mise-registry tools via `mise use -g <cmd>@latest` on a miss** — deferred: that would make the
  hook *add* mise-managed tools implicitly (a version-management decision that belongs in `mise.toml`, not
  an implicit install-on-type). The chosen behavior only RUNS what mise already manages; it does not
  silently adopt new mise tools.
- **Let both install** — rejected: two package managers owning one runtime is exactly the duplication E02
  warns against.
