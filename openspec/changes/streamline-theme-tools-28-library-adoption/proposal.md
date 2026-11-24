# OpenSpec Proposal — Streamline `@theme.tools` 28-Library Thin-Shell Adoption (`install.doctor`)

## 1. Intent & Scope

- **Project**: `install.doctor` (`workstation-and-developer-platform`)
- **Objective**: Ensure every screen, section, component, worker endpoint, audio/video pipeline, and observability hook delegates to the canonical **28 `@theme.tools/*` Libraries** via `theme.tools.json` (`schemaVersion: 2`) and `src/theme-tools-thin-shell.ts`.

## 2. Canonical Delegations

1. **Global Navigation & Marketing Sections (`@theme.tools/ui` & `@theme.tools/themes`)**:
   - `UniversalMegaMenuNavbar`, `BrandLogoLockup`, `SpotlightBentoCard`, `PillCluster`, `BtfReveal` with dark-first `#060610` / `#00E5FF` OKLCH tokens (`0.333s` transitions across all 16 interaction states, APCA `Lc >= 60`).
2. **Editorial & 100-Component Blog Catalog (`@theme.tools/blog`)**:
   - Full component registry (`renderComponent`, `COMPONENT_TYPES`, `ALL_BLOG_CSS`) and PlateJS editor at `/blog/*`.
3. **VoiceKit `$17,000` Credits Voice & Media Pipeline (`@theme.tools/media-video` & `@theme.tools/workflows`)**:
   - `buildVoiceKitTtsRequest()`, `buildVoiceKitPodcastStudioRequest()`, and `buildZeroCostVideoCreditExecutionPlan()` replacing ElevenLabs everywhere, with Cloudflare Workers AI MeloTTS (`@cf/myshell-ai/melotts`) and Piper ONNX fallback.
4. **Sovereign 8-Pillar Telemetry (`@theme.tools/telemetry`) & 13-Dimension Cloudflare Free-Tier Edge**:
   - W3C `traceparent`, Langfuse v4 OTLP (`2500ms` fail-open + 3-strike circuit breaker), PostHog 4-Event AI Tree, Sentry Envelope v7, GA4, GTM Consent Mode v2 (`gcs=G100`), Chromium Speculation Rules API, and Zstandard (`zstd`) edge compression.
