import { createThemeToolsTypedLintConfig } from '../aid-core/vendor/theme-tools/typed-eslint-config.js';

export default createThemeToolsTypedLintConfig({
  tsconfigRootDir: import.meta.dirname,
  profile: 'strict',
  project: 'tsconfig.json',
  files: ['{src,scripts,test}/**/*.mjs'],
});
