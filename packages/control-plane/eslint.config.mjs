import { fileURLToPath } from 'node:url';
import { createThemeToolsTypedLintConfig } from '../aid-core/vendor/theme-tools/typed-eslint-config.js';

const tsconfigRootDir = fileURLToPath(new URL('../../', import.meta.url));

// Remove each exact path as its existing strict lint findings are resolved.
const pendingFixtures = [
  'test/atomic-credential-claim.test.mjs',
  'test/broker-approval-managed-signer.test.mjs',
  'test/broker-approval-signer.test.mjs',
  'test/broker-authorization-api.test.mjs',
  'test/broker-authorization-composition.test.mjs',
  'test/broker-authorization-service.test.mjs',
  'test/broker-release-delegation-loader.test.mjs',
  'test/broker-run-intent-authority.test.mjs',
  'test/credential-lifecycle-rebuild.test.mjs',
  'test/debian-native-catalog-merge.test.mjs',
  'test/debian-native-composition.test.mjs',
  'test/desktop-release-builder.test.mjs',
  'test/desktop-release-channel.test.mjs',
  'test/desktop-release-publication.test.mjs',
  'test/disposable-product-composition.test.mjs',
  'test/helpers/worker-app-fixture.mjs',
  'test/offline-bundle-publication.test.mjs',
  'test/oidc-owner-enrollment.test.mjs',
  'test/privileged-step-up-http.test.mjs',
  'test/release-evidence-view.test.mjs',
  'test/release-publication.test.mjs',
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
