import { fileURLToPath } from 'node:url';
import { createThemeToolsTypedLintConfig } from '../aid-core/vendor/theme-tools/typed-eslint-config.js';

const tsconfigRootDir = fileURLToPath(new URL('../../', import.meta.url));

export default [
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
    files: ['packages/control-plane/test/control-plane.test.mjs'],
  }),
];
