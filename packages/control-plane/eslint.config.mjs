import { fileURLToPath } from 'node:url';
import { createThemeToolsTypedLintConfig } from '../aid-core/vendor/theme-tools/typed-eslint-config.js';

const tsconfigRootDir = fileURLToPath(new URL('../../', import.meta.url));

// Remove each exact path as its existing strict lint findings are resolved.
const pendingFixtures = [
  'test/debian-native-composition.test.mjs',
  'test/disposable-product-composition.test.mjs',
  'test/oidc-owner-enrollment.test.mjs',
  'test/privileged-step-up-http.test.mjs',
].map(file => `packages/control-plane/${file}`);

export default [
  { ignores: pendingFixtures },
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
