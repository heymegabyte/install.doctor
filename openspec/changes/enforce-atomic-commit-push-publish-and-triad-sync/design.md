# Design: Workstation Agent Harness 5-Phase Pipeline, Atomic Commit-Push-Publish Triad & Canonical Logo Registry

> **Architect:** antigravity
> **Architect Role:** assigned

## Architecture

1. **5-Phase Workstation Agent Harness Contract**:
   - **Phase 1 — MECH Prompt Hydration**: Hydrate 12/12 MECH dimensions with 1h (`3600s`) KV-cache prefix pinning and SHA-256-pinned primary vendor documentation research.
   - **Phase 2 — OpenSpec Architecture**: Frontier Architects (`claude`, `codex`, `antigravity` — never `opencode`) author and lock `openspec/changes/<change-id>/{proposal.md,design.md,tasks.md,specs/}` via Blind Generation -> Cross-Critique -> Weighted Consensus.
   - **Phase 3 — Golden Path TDD**: Drive implementation from the homepage (`/`) through multi-step UI interactions across 16 visual states, `0.333s` OKLCH transitions, and 6 Playwright breakpoints (`320/375/768/1024/1440/1920`) with `100%` unit and `90%+` E2E coverage under Nx (`parallel: 8`).
   - **Phase 4 — Recursive Scope Expansion**: Continuously generate and implement 2nd- and 3rd-order recommendations in the same turn until `0` justified recommendations remain.
   - **Phase 5 — Parallel Triad Value Absorption**: Concurrently absorb reusable components/engines into `heymegabyte/theme.tools`, host/workstation scripts and harness invariants into `heymegabyte/install.doctor`, and agent skills/rules into `heymegabyte/agent-skills`.

2. **Atomic Commit-Push-Publish Deployment Triad**:
   - Workstation closeout hooks and agent harnesses enforce that every web/worker project turn executes:
     1. **Commit**: Stage and create an atomic, Conventional Commit (`git commit`).
     2. **Push**: Push the verified commit to `origin/main` (`git push origin main`).
     3. **Publish & Purge**: Deploy to Cloudflare Workers (`wrangler deploy` / live publish) followed immediately by a Cloudflare CDN cache purge.
     4. **Live Edge HTTP Verification**: Probe and verify HTTP 200 and asset integrity across:
        - `https://<domain>/`
        - `https://<domain>/api/health`
        - `https://<domain>/og.png`
        - `https://<domain>/favicon.svg`
        - `https://<domain>/apple-touch-icon.png`

3. **Canonical Brand Logo Registry (`questionl.ink`)**:
   - Codifies the canonical brand asset specification in `AGENTS.md`:
     - `voice.build`: `/logos/10-sovereign-voice-crown-signature-ideogram.png`
     - `qubes.cloud`: `/logos/10-sovereign-voice-crown-signature-ideogram.png` (aliased with `10-sovereign-qubes-crown-signature-ideogram.png`)
     - `publish.engineer`: `/logos/08-sacred-folio-lissajous.png`
     - `post.vision`: `/logos/06-chronos-timeline-horizon-ideogram.png`
     - `template.company`: `/logos/05-titanium-company-foundry-ideogram.png`
     - `status.charity`: `/logos/06-verifiable-altruism-spectrogram-ideogram.png`
     - `questionl.ink`: `/logos/10-sovereign-questionlink-crown-ideogram.png` (`10-sovereign-questionlink-crown-transparent.png`, dark-navy `#181B2E` squircle with electric-cyan `#19B5FE` question-mark equalizer waveform bars `/favicon.svg` & `/apple-touch-icon.png`, `1200x630` `/og.png` with `"Train repositories by answering questions"`, and `home.megabyte.space` `/icons/question-link.png`).
