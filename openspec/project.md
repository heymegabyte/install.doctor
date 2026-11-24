# OpenSpec Project Specification — install.doctor

## 1. Overview & Domain

- **Repository**: `heymegabyte/install.doctor`
- **Primary Domain**: `https://install.doctor`
- **Control Plane**: Paperclip (`https://swarml.ink`) + OpenClaw (`https://openclaw.swarml.ink`)

## 2. Canonical `@theme.tools/*` Capability Bindings

- **Tier 1 (Core UI & Content)**: `@theme.tools/themes`, `@theme.tools/ui`, `@theme.tools/blog`, `@theme.tools/catalog`, `@theme.tools/testing`
- **Tier 2 (CF-Native SaaS Engines)**: `@theme.tools/workflows`, `@theme.tools/integrations`, `@theme.tools/forms`, `@theme.tools/crm`, `@theme.tools/billing`, `@theme.tools/status`, `@theme.tools/kb`
- **Tier 3 (Foundational Utilities)**: `@theme.tools/telemetry`, `@theme.tools/auth`, `@theme.tools/flags`, `@theme.tools/agent-ui`, `@theme.tools/seo-geo`, `@theme.tools/media-video` (VoiceKit `$17,000` Credits Tier), `@theme.tools/crawl-research`, `@theme.tools/i18n-a11y`

## 3. Verification & Multi-Axis Convergence Gates

- **TypeScript Strict**: Zero `any`, Zod validation on all external inputs, RFC 9457 `application/problem+json` error responses with W3C `traceparent`.
- **UI & Accessibility**: 6 Playwright breakpoints (`320px`, `375px`, `768px`, `1024px`, `1280px`, `1536px`), dark-first `#060610` palette, APCA contrast `Lc >= 60`, `CLS = 0`, `INP <= 200ms`.
- **Telemetry**: Langfuse `2500ms` fail-open timeout (`AbortSignal.timeout(2500)`), GTM Consent Mode v2 default-deny (`gcs=G100`), and zero leaked credentials/PII.
