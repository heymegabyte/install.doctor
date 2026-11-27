import { createThemeToolsTypedLintConfig } from './vendor/theme-tools/typed-eslint-config.js';

const tsconfigRootDir = import.meta.dirname;

export default [
  ...createThemeToolsTypedLintConfig({
    tsconfigRootDir,
    profile: 'strict',
    project: 'tsconfig.json',
    files: ['src/**/*.ts'],
  }),
  ...createThemeToolsTypedLintConfig({
    tsconfigRootDir,
    profile: 'strict',
    project: 'tsconfig.test.json',
    files: ['test/**/*.mjs'],
  }),
];
