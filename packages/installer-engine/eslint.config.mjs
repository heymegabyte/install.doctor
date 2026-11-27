import { fileURLToPath } from 'node:url';
import { createThemeToolsTypedLintConfig } from '../aid-core/vendor/theme-tools/typed-eslint-config.js';

const tsconfigRootDir = fileURLToPath(new URL('../../', import.meta.url));

// Each path has existing strict source diagnostics. Remove it once the module passes.
const pendingSourceFiles = [
  'src/engine.ts',
  'src/native-dpkg-transaction.ts',
  'src/offline-bundle.ts',
  'src/offline-execution.ts',
  'src/offline-orchestrator.ts',
  'src/offline-sandbox.ts',
  'src/privileged-broker-client.ts',
  'src/privileged-broker-controller.ts',
  'src/privileged-broker-device-approval.ts',
  'src/privileged-broker-local-approval.ts',
  'src/privileged-broker-store.ts',
  'src/privileged-broker-transaction-store.ts',
  'src/privileged-broker-worker.ts',
  'src/privileged-systemd-transaction-store.ts',
  'src/rollback-executor.ts',
  'src/sudo-credential-cleanup.ts',
  'src/verified-artifact-materializer.ts',
].map(file => `packages/installer-engine/${file}`);

export default [
  { ignores: pendingSourceFiles },
  ...createThemeToolsTypedLintConfig({
    tsconfigRootDir,
    profile: 'strict',
    project: 'packages/installer-engine/tsconfig.json',
    files: ['packages/installer-engine/src/**/*.ts'],
  }),
];
