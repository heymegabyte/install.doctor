import { fileURLToPath } from 'node:url';
import { createThemeToolsTypedLintConfig } from '../aid-core/vendor/theme-tools/typed-eslint-config.js';

const tsconfigRootDir = fileURLToPath(new URL('../../', import.meta.url));

// Each path has existing strict source diagnostics. Remove it once the module passes.
const pendingSourceFiles = [
  'src/better-auth-options.ts',
  'src/bootstrap.ts',
  'src/broker-approval-managed-signer.ts',
  'src/broker-authorization-api.ts',
  'src/broker-authorization-composition.ts',
  'src/broker-authorization-service.ts',
  'src/broker-exact-plan-d1-authority.ts',
  'src/broker-production-authorities.ts',
  'src/broker-release-delegation-loader.ts',
  'src/broker-run-intent-authority.ts',
  'src/broker-run-intent-d1-store.ts',
  'src/desktop-release-channel.ts',
  'src/env.ts',
  'src/http-security.ts',
  'src/index.ts',
  'src/privileged-step-up.ts',
  'src/release-channel.ts',
  'src/release-evidence-view.ts',
  'src/release-keyring.ts',
  'src/release-store.ts',
].map(file => `packages/control-plane/${file}`);

export default [
  { ignores: pendingSourceFiles },
  ...createThemeToolsTypedLintConfig({
    tsconfigRootDir,
    profile: 'strict',
    project: 'packages/control-plane/tsconfig.json',
    files: ['packages/control-plane/src/**/*.ts'],
  }),
  ...createThemeToolsTypedLintConfig({
    tsconfigRootDir,
    profile: 'strict',
    project: 'packages/control-plane/tsconfig.tooling.json',
    files: ['packages/control-plane/scripts/**/*.mjs', 'scripts/build-desktop-tools-release.mjs', 'scripts/verify-desktop-tools-release.mjs'],
  }),
  ...createThemeToolsTypedLintConfig({
    tsconfigRootDir,
    profile: 'strict',
    project: 'packages/control-plane/tsconfig.test.json',
    files: ['packages/control-plane/test/**/*.mjs'],
  }),
];
