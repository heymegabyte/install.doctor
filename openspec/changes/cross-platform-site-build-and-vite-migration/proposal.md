# Proposal: Cross-Platform Legacy Site Build & Vite/`@theme.tools` Migration

> **Architect:** antigravity
> **Architect Role:** assigned

## Why

Contributors cloning `heymegabyte/install.doctor` on Windows (and clean Linux/macOS checkouts without prebuilt Docusaurus assets) hit immediate build failures inside `site/` (`install.doctor#172` / `MEG-97`):

1. `site/stencil.config.ts` unconditionally copied `../docs/build`, crashing `npm run build` and `npm start` with `ENOENT: no such file or directory, stat '.../site/docs/build'` whenever Docusaurus had not been built first.
2. `site/stencil.config.ts` pointed `globalStyle` at the POSIX symlink `src/global/style.scss -> style-default.scss`, which checks out as an 18-byte plain-text stub on Windows when `core.symlinks=false`, breaking Sass compilation.
3. `site/package.json` (`build:noscript`) and `site/docs/package.json` (`prebuild`, `generate-plugin-docs`) embedded POSIX shell commands (`rm`, `ln -s`, `cp`, `bash`, `{ if [ -n ... ]; fi; }`) and an EOL Volta Node 16 pin, failing immediately under Windows `cmd.exe` / PowerShell.

Beyond immediate cross-platform unblocking, the legacy Stencil v3 + Docusaurus v2 (`0.0.0-4192`) stack in `site/` predates the canonical Cloudflare Workers + Vite + React 19 + `@theme.tools/ui` + `@theme.tools/blog` stack and the Desktop Tools (`desktop.tools`) product convergence.

## What Changes

- **Phase 1 (Implemented in MEG-97 / `#172`):**
  - Select `./src/global/style-offline.scss` vs `./src/global/style-default.scss` directly via `process.env.SITE_NOSCRIPT === '1'` in `site/stencil.config.ts`, removing reliance on the `src/global/style.scss` symlink.
  - Guard `{ src: '../docs/build', dest: 'docs' }` in `site/stencil.config.ts` with `existsSync(join(__dirname, 'docs', 'build'))` so standalone `npm run build` and `npm start` succeed on fresh checkouts while still embedding `/docs` whenever `docs/build` exists.
  - Replace POSIX shell pipelines in `site/package.json` (`build:noscript`) and `site/docs/package.json` (`prebuild`, `generate-plugin-docs`, `prestart`) with cross-platform Node ESM scripts (`site/scripts/build-noscript.mjs`, `site/docs/scripts/prebuild.mjs`, `site/docs/scripts/generate-plugin-docs.mjs`) that delegate to `site/docs/scripts/markdown.sh` on POSIX CI when `bash` + `rsync` + `shdoc` + `task` are present and fall back to a pure Node `fs` mirror + MDX-safe script/Taskfile extractor on Windows and minimal developer hosts.
  - Align `site/docs/package.json` Volta runtime to `20.20.2` (matching `site/package.json`) and add SHA-pinned `windows-latest` CI verification in `.github/workflows/site-build.yml` plus `scripts/test-site-windows-build.sh`.
- **Phase 2 (Queued Follow-Up Convergence):**
  - Replace the legacy Stencil v3 + Docusaurus v2 marketing/docs bundle with a Cloudflare Workers + Hono + React 19 + Vite + `@theme.tools/ui` + `@theme.tools/blog` + `@theme.tools/seo-geo` site aligned with Desktop Tools (`desktop.tools`), retiring Firebase manual hosting (`site-deploy.yml`) only after route-for-route redirect, SEO/JSON-LD, and 6-breakpoint Playwright parity gates pass.

## Capabilities

### New Capabilities

- `cross-platform-site-build`: Deterministic Windows, macOS, and Linux local and CI builds for `site/` and `site/docs/` without symlink privileges or mandatory POSIX shell utilities.

### Modified Capabilities

- None.

## Impact

- Unblocks Windows and clean-checkout contributors immediately (`install.doctor#172`) with zero changes to manual Firebase deployment authority (`site-deploy.yml` remains `workflow_dispatch`-only per `CLAUDE.md` §9.21).
- Preserves byte-for-byte `markdown.sh` (`shdoc` + `task`) output on Linux CI (`site-preview.yml`, `site-deploy.yml`) while providing a hermetic Node fallback on Windows.
