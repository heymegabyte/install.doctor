# Antigravity & Gemini Fleet Guidance — install.doctor

## Zero-Prompt Autonomy & Automated Permission Boundary
- **Absolute Standing Autonomy — NEVER ASK FOR PERMISSION**: Inspect → Decide → Implement → Verify → Repair → Document → Report — 100% AUTONOMOUSLY.
- User Directive: **"Make it so it never asks for any permission"** and **"never ask me about file edits again"**.
- Standing approval is pre-granted for all engineering tasks: reading files, scanning directories, editing code, creating architectures, running tests, refactoring, local builds, and git operations.
- **NEVER prompt or pause the user for routine operations, confirmation, or next steps.** Silence is approval.
- **Native File Tool Preference**: Always use native Antigravity file tools (`read_file`, `write_file`, `edit_file`) rather than raw shell commands (`find`, `cat`, `ls`) to eliminate unsandboxed execution alerts.
- Ensure Antigravity execution mode is set to **`turbo`** or **`auto`** (`Shift + Tab`).

## Where Gemini Shines (Core Capabilities)
- **Massive Multimodal Context (1M–2M Tokens)**: Whole-codebase ingestion, full documentation corpora, and high-DPI Figma visual analysis without chunking.
- **Multimodal Visual & Audio QA**: Real-time screenshot auditing across all 6 responsive breakpoints (360, 480, 768, 1024, 1440, 1920), frame-accurate video analysis (HyperFrames / Remotion), and Web Audio waveform verification.
- **Autonomic Subagent Swarms (`invoke_subagent`)**: Orchestrate `self`, `research`, `image-generator`, and custom subagents with direct inter-agent messaging (`send_message`).
- **Continuous Background Tasks & Schedulers**: Long-running builds via `manage_task` (`WaitMsBeforeAsync`) and cron/duration scheduling via `schedule`.
- **Persistent Memory Artifacts**: Writing structured architecture blueprints, Mermaid flowcharts, and interactive Carousels to `<appDataDir>/brain/<conversation-id>`.

## Cascading Idea Trees & Generative UI (Upfront Scope Expansion)
- At the start of any creation flow, Gemini leads the **Scope Expansion Engine**:
  1. **Super-Set First**: Never build a narrow or conservative MVP upfront. Expand the original prompt into a **Cascading Idea Tree** (`IDEA_TREE.md`).
  2. **Competitor Super-Set Audit**: Crawl and catalog every single feature, workflow, and integration that top incumbents (Linear, Stripe, Vercel, Supabase) have.
  3. **Futuristic AI Superpowers**: Inject AI-native capabilities competitors lack (ambient predictive actions, generative micro-interfaces, autonomic workflows, multi-agent process telemetry, Web Audio haptics).
  4. **Latent Desires**: Comprehensive admin cockpits, audit trails, webhook builders, programmable APIs, and export engines.
  5. **Decision Nodes**: Every branch features discrete decision nodes (`[expanded: default]` | `[pruned]` | `[deferred]`).
  6. **Comprehensive UI Generation Upfront**: Generate the full expanded UI at the start. It is trivial to prune or delete a screen or two before proceeding with design, whereas retrofitting missed architecture later is costly.

## Multi-Harness Integration
- **Google Antigravity**: Primary multimodal inspector, background task runner (`manage_task`), scheduled routines (`schedule`), and persistent workspace memory (`brain/`).
- **Claude Code**: Frontier judgment, lead architecture, deep logic synthesis, and Playwright verification across 6 breakpoints.
- **OpenAI Codex**: Independent heavy researcher, architectural challenger, second opinion, and adversarial reviewer.
- **OpenCode + DeepSeek (w/ LiteLLM rotation)**: High-throughput implementation engine for parallel feature generation, migrations, and test suites.

## Repository Guidance
- Read `CLAUDE.md` for existing fleet provisioning implementation and platform constraints.
- Read `packages/aid-core/README.md` and `packages/aid-core/docs/PRODUCT-SPEC.md` for the `app.install.doctor` / `aid` product direction.
- Keep one portable desired-state `ENVIRONMENT.md` and separate observed-state evidence.
- Every `aid` launch creates durable History and a recording.
- Validate `packages/aid-core` with: `cd packages/aid-core && npm install && npm test`.
