import { fileURLToPath } from 'node:url';
import { createThemeToolsTypedLintConfig } from './vendor/theme-tools/typed-eslint-config.js';

const tsconfigRootDir = fileURLToPath(new URL('../../', import.meta.url));

export default [
  ...createThemeToolsTypedLintConfig({
    tsconfigRootDir,
    profile: 'strict',
    project: 'packages/aid-core/tsconfig.json',
    files: ['packages/aid-core/src/**/*.ts'],
  }),
  ...createThemeToolsTypedLintConfig({
    tsconfigRootDir,
    profile: 'strict',
    project: 'packages/aid-core/tsconfig.test.json',
    files: ['packages/aid-core/test/**/*.mjs', 'scripts/check-offline-secret-inventory.mjs'],
  }),
];
