# Tasks: Cross-Platform Legacy Site Build & Vite/`@theme.tools` Migration

## 1. Cross-Platform Stencil & Docs Build Unblocking (MEG-97 / `#172`)

- [x] 1.1 Add failing-first regression gate `scripts/test-site-windows-build.sh` verifying symlink-free `stencil.config.ts`, guarded `../docs/build` copy, POSIX-free `package.json` scripts, hermetic Node docs mirror fallback, and 40-SHA-pinned Windows CI workflow.
- [x] 1.2 Update `site/stencil.config.ts` to select `style-offline.scss` vs `style-default.scss` via `SITE_NOSCRIPT` and guard `../docs/build` copy with `existsSync(join(__dirname, 'docs', 'build'))`.
- [x] 1.3 Replace `site/package.json` `build:noscript` POSIX shell chain with `site/scripts/build-noscript.mjs` and align `site/docs/package.json` (`prebuild`, `generate-plugin-docs`, `prestart`, `volta.node`) on cross-platform Node ESM wrappers (`prebuild.mjs`, `generate-plugin-docs.mjs`).
- [x] 1.4 Add `.github/workflows/site-build.yml` (`windows-latest`, Node 22, PowerShell, 40-char SHA-pinned actions) and document cross-platform build commands in `site/CLAUDE.md` without creating `site/README.md`.

## 2. Phase 2 — Legacy Stencil/Docusaurus -> Vite + React 19 + `@theme.tools` Migration

- [ ] 2.1 Inventory all prerendered routes in `site/src/` and documentation slugs in `site/docs/` into a machine-verifiable URL & redirect parity manifest aligned with Desktop Tools (`desktop.tools`).
- [ ] 2.2 Scaffold Cloudflare Workers + Hono + React 19 + Vite site consuming `@theme.tools/themes`, `@theme.tools/ui`, `@theme.tools/blog`, and `@theme.tools/seo-geo` with dark-first (`#060610` / `#00E5FF`) tokens and JSON-LD structured data.
- [ ] 2.3 Migrate canonical `docs/` + script/Taskfile reference rendering into build-time TypeScript content collections with full-text search and zero runtime POSIX shell dependencies.
- [ ] 2.4 Pass 6-breakpoint Playwright E2E, WCAG 2.2 AA (`axe-core`), and Core Web Vitals budgets on preview deployment, then execute approved cutover retiring manual Firebase `site-deploy.yml`.
