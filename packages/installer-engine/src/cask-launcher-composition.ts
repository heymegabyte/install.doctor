import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { TaskNodeSchema } from './contracts.js';
import { calculateLoadPlanReportDigest, LoadPlanReportSchema } from './lazy-plan.js';

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const PackageKeySchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._:-]*$/);
const SafeAppBundleSchema = z.string().min(5).max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._+()-]*\.app$/)
  .refine(value => !value.includes('/') && !value.includes('\\'), 'app bundle must be a basename');
const SafeBinSchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._+-]*$/);
const AbsolutePathSchema = z.string().min(1).max(4096)
  .refine(value => isAbsolute(value) && resolve(value) === value, 'path must be canonical and absolute');

export const CaskLauncherOperationSchema = z.strictObject({
  kind: z.literal('managed-cask-launcher'),
  action: z.enum(['check', 'apply', 'verify']),
  packageKey: PackageKeySchema,
  appBundle: SafeAppBundleSchema,
  appPaths: z.tuple([AbsolutePathSchema, AbsolutePathSchema]),
  targetPath: AbsolutePathSchema,
  candidateMode: z.literal(0o700),
  policy: z.literal('home-applications-before-system-v1'),
});

const InputSchema = z.strictObject({
  loadPlan: LoadPlanReportSchema,
  approvedLoadPlanDigest: DigestSchema,
  homeDirectory: AbsolutePathSchema,
  legacyPackages: z.array(PackageKeySchema).max(4096),
});

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export function composeSelectedCaskLaunchers(rawInput: unknown) {
  const input = InputSchema.parse(rawInput);
  if (input.loadPlan.platform !== 'macos') throw new Error('cask launcher composition requires a macOS load plan');
  const calculated = calculateLoadPlanReportDigest(input.loadPlan);
  if (calculated !== input.loadPlan.digest || input.approvedLoadPlanDigest !== calculated) {
    throw new Error('cask launcher composition requires the exact approved load-plan digest');
  }
  if (new Set(input.legacyPackages).size !== input.legacyPackages.length) throw new Error('legacy package roots contain duplicates');
  const launcherRoot = join(input.homeDirectory, '.local', 'bin', 'cask');
  const directoryRequirements = [{ targetPath: launcherRoot, targetMode: 0o700 as const }];
  const launchers = input.loadPlan.items.filter(item => item.selected && item.applicable
    && item.actions.includes('install') && item.caskLauncher !== null)
    .map(item => {
      if (!input.loadPlan.installOrder.includes(item.name) || !input.legacyPackages.includes(item.name)) {
        throw new Error(`cask launcher lacks exact selected legacy package authority: ${item.name}`);
      }
      const appBundle = SafeAppBundleSchema.parse(item.caskLauncher?.appBundle);
      const bin = SafeBinSchema.parse(item.caskLauncher?.bin);
      const operation = (action: 'check' | 'apply' | 'verify') => CaskLauncherOperationSchema.parse({
        kind: 'managed-cask-launcher', action, packageKey: item.name, appBundle,
        appPaths: [join(input.homeDirectory, 'Applications', appBundle), join('/Applications', appBundle)],
        targetPath: join(launcherRoot, bin), candidateMode: 0o700,
        policy: 'home-applications-before-system-v1',
      });
      const operations = { check: operation('check'), apply: operation('apply'), verify: operation('verify') };
      const task = TaskNodeSchema.parse({
        schemaVersion: 1, id: `installer.cask-launcher.${item.name}`,
        inputDigest: digest({ loadPlanDigest: calculated, operations }),
        dependencies: ['desired.packages', 'installer.cask-launcher-directory'], predicate: 'darwin-native',
        requiredCapabilities: [], operations: {
          check: `cask-launcher-${item.name}-check`, apply: `cask-launcher-${item.name}-apply`,
          verify: `cask-launcher-${item.name}-verify`,
        },
        timeoutMs: 30_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
        resources: { cpu: 1, memoryMiB: 64, network: false }, privilege: 'user', network: 'none',
        consent: 'none', lockDomains: ['installer-configuration'], cleanup: 'none',
        compensation: 'configuration', failurePolicy: 'abort-run',
      });
      return { schemaVersion: 1 as const, packageKey: item.name, appBundle, bin, task, operations };
    });
  const targets = new Map<string, string>();
  for (const launcher of launchers) {
    const previous = targets.get(launcher.operations.apply.targetPath);
    if (previous) throw new Error(`cask launcher target collision: ${previous} and ${launcher.packageKey}`);
    targets.set(launcher.operations.apply.targetPath, launcher.packageKey);
  }
  const migratedLauncherPackages = launchers.map(item => item.packageKey);
  return {
    schemaVersion: 1 as const, loadPlanDigest: calculated, launcherRoot,
    directoryRequirements,
    launchers, migratedLauncherPackages,
    remainingLegacyLauncherPackages: input.legacyPackages.filter(name => !migratedLauncherPackages.includes(name)),
  };
}
