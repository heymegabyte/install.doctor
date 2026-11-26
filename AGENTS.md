# Repository agent guidance

Read CLAUDE.md for the existing fleet provisioning implementation and platform constraints.
For the desktop.tools product direction (which replaces retired desktop.tools, aid, and app.install.doctor),
also read packages/aid-core/README.md and packages/aid-core/docs/PRODUCT-SPEC.md.

As of 2026-10-26, packages/aid-core is an isolated pre-production TypeScript foundation.
It is not wired into the bootstrap, site, a daemon, or production routing. Do not claim
that browser terminals, OpenCode forking, skill installation, or fleet orchestration are
implemented merely because their interfaces and intended behavior are documented.

packages/aid-core also contains pure, side-effect-free Probabilistic Intent, edge-placement,
and Easter-Egg contracts. They are unit-tested but are not wired into the bootstrap, site,
control plane, daemon, routing, or UI. Treat them as experimental contracts, never as shipped
product capability, until an explicit integration decision exists.

New product decisions: desktop.tools (replacing desktop.tools, aid, and app.install.doctor) is browser-first;
desktop-tools is the intended OpenCode derivative; reuse shared ProjectSites routing with DeepSeek
preferred and no LiteLLM; hiSHtory is preferred over Atuin; Alloy replaces Promtail for new Loki
integration work. Existing history and running services must be preserved until tested migrations exist.

The no-LiteLLM decision above applies only to the customer-facing `desktop-tools` product runtime.
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
Implement the complete theme.tools-based responsive SaaS scaffold first with typed fixtures and browser verification, then drive feature behavior through test-driven vertical slices.

Validate the isolated package with: cd packages/aid-core && npm install && npm test.
Preserve the existing master-branch workflow and do not deploy as a side effect of tests.

Prefer TypeScript (Node 24 native strip-types or Bun) and Bash over Python for all new
application code, CLIs, tools, verifiers, exporters, automation scripts, and tests
(`~/.agentskills/rules/brian-preferences.md`, `~/.agentskills/rules/code-style.md`). Never
default to Python for convenience.

## Parallel Triad Convergence, Frontier OpenSpec & Langfuse Fail-Open Mandate

1. **Parallel End-of-Turn Triad (`agent-skills` + `install.doctor` + `theme.tools`) & Opportunistic `theme.tools` Upstream Extraction Mandate (Thin-Shell Consumer Repositories)**: Whenever a prompt pass reveals reusable system configs, dotfiles, shell exports, CLI shims, or service units, apply them to `install.doctor` in parallel next to `agent-skills` and `theme.tools`, save future/multi-step work via OpenSpec (`openspec/changes/<change-id>/`), and register the linked issue in the `install.doctor` Paperclip project (`d97b0204-ca63-4117-b469-2fe0f2470d18`) via `~/.agentskills/bin/openspec-paperclip-sync.ts`. Always opportunistically upgrade `theme.tools` (`@theme.tools/*`) while working whenever any component, calculator, advisor, workflow, validator, hook, or library code can potentially be reused across sites or applications so consumer repositories contain primarily overall structure, routing, data bindings, and thin configuration adapters rather than standalone source implementations for reusable components and libraries across its 28 default libraries (`@theme.tools/{themes,ui,blog,catalog,testing,workflows,integrations,social,scheduling,signing,forms,links,keys,notifications,crm,inbox,billing,status,kb,dataplane,telemetry,auth,flags,agent-ui,seo-geo,media-video,crawl-research,i18n-a11y}`).
2. **Frontier Architect Only for OpenSpec (`claude` / `codex` / `antigravity` — NEVER `opencode`)**: OpenSpec `proposal.md`, `design.md`, `tasks.md`, and `specs/` MUST be authored by `claude` (with a fully-loaded, hydrated context), `codex`, or `antigravity`. Never author OpenSpec architectural details with `opencode`.
3. **Langfuse Always-On + Graceful Timeout Fallback (`2500ms`)**: Keep `LANGFUSE_TIMEOUT_MS=2500`, `LANGFUSE_FAIL_OPEN=true`, and `LANGFUSE_SPOOL_DIR` active in `home/dot_config/shell/megabyte-cache.sh.tmpl` so Langfuse outages never block workstation or agent execution.
4. **Safe Prompt Closeout**: Before declaring a prompt complete, implement every safe, authorized, dependency-closed recommendation. In parallel where independent, evaluate and apply relevant contributions to `theme.tools`, `install.doctor`, `agent-skills`, and touched projects; update affected documentation and comments that explain non-obvious behavior. Record blocked, unsafe, unauthorized, or inapplicable work truthfully—this mandate does not expand authority.
5. **Observability by Design**: Applicable product designs must integrate consent-aware PostHog, GA4, and GTM plus correlated Langfuse and Sentry telemetry. Require redaction, tenant/environment isolation, bounded fail-open behavior, and executed delivery/consent/outage verification; configuration text alone is not proof.
6. **Every-Prompt 5-Phase Execution Pipeline**: Every prompt execution follows the 5-Phase pipeline: (1) **MECH Prompt Hydration** (`12/12` zero-miss dimensions, `3600s` KV-cache prefix pinning, SHA-256-pinned primary vendor documentation research) -> (2) **OpenSpec Architecture** (`claude` / `codex` / `antigravity` Frontier conference, never `opencode`) -> (3) **Golden Path TDD** (Homepage-first deep UI Golden Path Nx TDD with `100%` unit coverage and `90%+` E2E across 16 visual states, `0.333s` OKLCH transitions, and 6 Playwright breakpoints `320/375/768/1024/1440/1920`) -> (4) **Recursive Scope Expansion** (2nd- and 3rd-order recommendation loop in the same turn until `0` remain) -> (5) **Parallel Triad Value Absorption** (`theme.tools` + `install.doctor` + `agent-skills`).
7. **Atomic Commit-Push-Publish Deployment Triad**: Every web/worker project turn must execute the atomic deployment triad before completion: `git commit` -> `git push origin main` -> `wrangler deploy` / live publish + Cloudflare CDN cache purge -> live edge HTTP verification of `https://<domain>/`, `/api/health`, `/og.png`, `/favicon.svg`, and `/apple-touch-icon.png`.
8. **Canonical Brand Logo, Favicon & Apple Touch Icon Registry**:
   - **`voice.build`**: `/logos/10-sovereign-voice-crown-signature-ideogram.png` (extracted dark-navy `#0E1528` + turquoise-cyan `#25D0D0` voice waveform `/favicon.svg`, `/apple-touch-icon.png`, and `home.megabyte.space` `/icons/voice-build.png`).
   - **`qubes.cloud`**: `/logos/10-sovereign-voice-crown-signature-ideogram.png` (aliased with `10-sovereign-qubes-crown-signature-ideogram.png`; extracted emerald-cyan to violet isometric wireframe tesseract `/favicon.svg`, `/apple-touch-icon.png`, and `home.megabyte.space` `/icons/qubes-cloud.png`).
   - **`publish.engineer`**: `/logos/08-sacred-folio-lissajous.png` (4-concentric-line neon `P.E` monogram `/favicon.svg`, two-line stacked `PUBLISH.` / `ENGINEER` `/apple-touch-icon.png`, and `home.megabyte.space` `/icons/publish-engineer.png`).
   - **`post.vision`**: `/logos/06-chronos-timeline-horizon-ideogram.png` (4-concentric-line neon `pv` monogram with coral bullseye ring `/favicon.svg`, two-line stacked `post.` / `vision` `/apple-touch-icon.png` with horizon reflection, and `home.megabyte.space` `/icons/post-vision.png`).
   - **`template.company`**: `/logos/05-titanium-company-foundry-ideogram.png` (`05-titanium-company-foundry-transparent.png`, double-line paperclip-capsule `T` `/favicon.svg` & `/apple-touch-icon.png`, and `home.megabyte.space` `/icons/template-company.png`).
   - **`status.charity`**: `/logos/06-verifiable-altruism-spectrogram-ideogram.png` (`06-verifiable-altruism-spectrogram-transparent.png`, horizontal-segmented equalizer spectrogram `s.c` `/favicon.svg`, two-line stacked `status.` / `charity` `/apple-touch-icon.png`, and `home.megabyte.space` `/icons/status-charity.png`).
   - **`questionl.ink`**: `/logos/08-sacred-dialectic-lissajous-ideogram.png` (`08-sacred-dialectic-lissajous-transparent.png`, 4-concentric-line neon `Q.I` monogram `/favicon.svg`, two-line stacked `QUESTIONL.` / `INK` `/apple-touch-icon.png` & `/android-chrome-192x192.png`, `1200x630` `/og.png` & `/featured-image.png` with `"Train repositories by answering questions"`, and `home.megabyte.space` `/icons/question-link.png`).
   - **Post-Crowning Logo Studio Gallery Removal**: Once a project's official logo has been crowned from the 10-edition Codex+Ideogram exploration suite, remove the 10-edition Coming Soon Logo Studio gallery from below the live application dashboard (`/`) so the dashboard renders only its core functional UI.
