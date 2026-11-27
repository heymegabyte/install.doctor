import { fileURLToPath } from 'node:url';
import { createThemeToolsTypedLintConfig } from '../aid-core/vendor/theme-tools/typed-eslint-config.js';

export default createThemeToolsTypedLintConfig({
  tsconfigRootDir: fileURLToPath(new URL('../../', import.meta.url)),
  profile: 'strict',
  project: 'packages/control-plane/tsconfig.tooling.json',
  files: ['packages/control-plane/scripts/**/*.mjs', 'scripts/verify-desktop-tools-release.mjs'],
});
