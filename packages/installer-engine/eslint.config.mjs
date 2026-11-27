import { fileURLToPath } from 'node:url';
import { createThemeToolsTypedLintConfig } from '../aid-core/vendor/theme-tools/typed-eslint-config.js';

const tsconfigRootDir = fileURLToPath(new URL('../../', import.meta.url));

export default createThemeToolsTypedLintConfig({
  tsconfigRootDir,
  profile: 'strict',
  project: 'packages/installer-engine/tsconfig.json',
  files: ['packages/installer-engine/src/**/*.ts'],
});
