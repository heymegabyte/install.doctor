# Repository agent guidance

Read CLAUDE.md for the existing fleet provisioning implementation and platform constraints.
For the new app.install.doctor / aid product direction, also read
packages/aid-core/README.md and packages/aid-core/docs/PRODUCT-SPEC.md.

As of 2026-10-26, packages/aid-core is an isolated pre-production TypeScript foundation.
It is not wired into the bootstrap, site, a daemon, or production routing. Do not claim
that browser terminals, OpenCode forking, skill installation, or fleet orchestration are
implemented merely because their interfaces and intended behavior are documented.

packages/aid-core also contains pure, side-effect-free Probabilistic Intent, edge-placement,
and Easter-Egg contracts. They are unit-tested but are not wired into the bootstrap, site,
control plane, daemon, routing, or UI. Treat them as experimental contracts, never as shipped
product capability, until an explicit integration decision exists.

New product decisions: app.install.doctor is browser-first; aid is the intended OpenCode
derivative; reuse shared ProjectSites routing with DeepSeek preferred and no LiteLLM;
hiSHtory is preferred over Atuin; Alloy replaces Promtail for new Loki integration work.
Existing history and running services must be preserved until tested migrations exist.

The no-LiteLLM decision above applies only to the customer-facing `aid` product runtime.
Internal development, research, and test-generation agents follow the canonical
`~/.agentskills/rules/agent-provider-policy.md`: first offload every effectively executable
unit through OpenCode → LiteLLM → local Ollama or rotating DeepSeek, and assess safe swarm
fan-out for every delegation. Premium subscription models retain decomposition, frontier
judgment, sensitive/shared-state decisions, integration, and final verification.

Keep one portable desired-state ENVIRONMENT.md and separate observed-state evidence.
Every future aid launch must create durable History and a recording, including local,
scheduled, child and offline runs. Install approved pinned agent-skills automatically,
but load only the relevant skills into context. Respect least privilege and consent.

Do not reintroduce Nix, require GUI interaction on headless machines, remove platform
paths, or background-replace running applications. Keep secrets out of Markdown exports.
Require approved Figma designs before implementing the full SaaS UI.

Validate the isolated package with: cd packages/aid-core && npm install && npm test.
Preserve the existing master-branch workflow and do not deploy as a side effect of tests.

Prefer TypeScript (Node 24 native strip-types or Bun) and Bash over Python for all new
application code, CLIs, tools, verifiers, exporters, automation scripts, and tests
(`~/.agentskills/rules/brian-preferences.md`, `~/.agentskills/rules/code-style.md`). Never
default to Python for convenience.

## Parallel Triad Convergence, Frontier OpenSpec & Langfuse Fail-Open Mandate

1. **Parallel End-of-Turn Triad (`agent-skills` + `install.doctor` + `theme.tools`)**: Whenever a prompt pass reveals reusable system configs, dotfiles, shell exports, CLI shims, or service units, apply them to `install.doctor` in parallel next to `agent-skills` and `theme.tools`, save future/multi-step work via OpenSpec (`openspec/changes/<change-id>/`), and register the linked issue in the `install.doctor` Paperclip project (`d97b0204-ca63-4117-b469-2fe0f2470d18`) via `~/.agentskills/bin/openspec-paperclip-sync.ts`. All reusable cross-site application utilities, UI components, and CF-native ports of **Activepieces**, **Nango**, and **Postiz** belong in `@theme.tools` (`heymegabyte/theme.tools`).
2. **Frontier Architect Only for OpenSpec (`claude` / `codex` / `antigravity` — NEVER `opencode`)**: OpenSpec `proposal.md`, `design.md`, `tasks.md`, and `specs/` MUST be authored by `claude` (with a fully-loaded, hydrated context), `codex`, or `antigravity`. Never author OpenSpec architectural details with `opencode`.
3. **Langfuse Always-On + Graceful Timeout Fallback (`2500ms`)**: Keep `LANGFUSE_TIMEOUT_MS=2500`, `LANGFUSE_FAIL_OPEN=true`, and `LANGFUSE_SPOOL_DIR` active in `home/dot_config/shell/megabyte-cache.sh.tmpl` so Langfuse outages never block workstation or agent execution.
