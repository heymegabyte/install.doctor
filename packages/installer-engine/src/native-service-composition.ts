import { createHash } from 'node:crypto';
import { z } from 'zod';
import { TaskNodeSchema } from './contracts.js';
import type { TaskNode } from './contracts.js';
import { LoadPlanReportSchema, calculateLoadPlanReportDigest } from './lazy-plan.js';
import { NativeServiceOperationSchema, OfflineOperationManifestSchema } from './offline-execution.js';
import type { NativeServiceOperation, OfflineOperationManifest } from './offline-execution.js';

const CatalogKey = z.string().regex(/^[a-z0-9][a-z0-9._:-]*$/).max(128);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonical(child)]));
  return value;
}

export type NativeSystemdServiceComposition = Readonly<{
  task: TaskNode;
  operations: OfflineOperationManifest;
  remainingLegacyServices: readonly string[];
}>;

/**
 * Exact first service cutover. This composes authority only; execution remains
 * fail-closed until the privileged broker supplies durable service-state
 * compensation for the same operation triplet.
 */
export function composeSelectedNativeSystemdService(input: {
  loadPlan: unknown;
  loadPlanDigest: string;
  serviceKey: string;
  legacyServices: readonly string[];
}): NativeSystemdServiceComposition {
  const loadPlan = LoadPlanReportSchema.parse(input.loadPlan);
  if (calculateLoadPlanReportDigest(loadPlan) !== loadPlan.digest || input.loadPlanDigest !== loadPlan.digest) {
    throw new Error('native service composition requires the exact load-plan digest');
  }
  const serviceKey = CatalogKey.parse(input.serviceKey);
  if (serviceKey !== 'alloy' || loadPlan.platform !== 'linux') {
    throw new Error('native service slice admits only alloy on Linux');
  }
  const item = loadPlan.items.find(candidate => candidate.name === serviceKey);
  if (!item || !item.selected || item.selectionReason !== 'desired-service'
    || JSON.stringify(item.actions) !== JSON.stringify(['install', 'start'])) {
    throw new Error('native service is not explicitly selected in the load plan');
  }
  const declarations = item.serviceDeclarations.filter(candidate => candidate.manager === 'systemd');
  if (declarations.length !== 1 || declarations[0]?.name !== 'alloy.service'
    || declarations[0].privilege !== 'admin' || declarations[0].packageProvider !== undefined) {
    throw new Error('native alloy service lacks exact systemd authority');
  }
  const operationIds = {
    check: 'native-systemd-alloy-check', apply: 'native-systemd-alloy-apply', verify: 'native-systemd-alloy-verify',
  } as const;
  const operation = (action: 'check' | 'apply' | 'verify'): NativeServiceOperation => NativeServiceOperationSchema.parse({
    kind: 'native-service', effectClass: 'native-service', action,
    manager: 'systemd', unit: 'alloy.service', desiredState: 'enabled-and-started',
  });
  const operations = OfflineOperationManifestSchema.parse({
    schemaVersion: 5, configurationRoots: [], operations: {
      [operationIds.check]: operation('check'),
      [operationIds.apply]: operation('apply'),
      [operationIds.verify]: operation('verify'),
    },
  });
  const task = TaskNodeSchema.parse({
    schemaVersion: 1, id: 'service.native.alloy',
    inputDigest: createHash('sha256').update(JSON.stringify(canonical({ loadPlanDigest: loadPlan.digest, operations }))).digest('hex'),
    dependencies: ['desired.packages'], predicate: 'linux-native', requiredCapabilities: [], operations: operationIds,
    timeoutMs: 60_000, retry: { class: 'never', maxAttempts: 1, backoffMs: 0 },
    resources: { cpu: 1, memoryMiB: 64, network: false }, privilege: 'admin', network: 'none',
    consent: 'privileged', lockDomains: ['service-manager.systemd'], cleanup: 'none', compensation: 'configuration',
    failurePolicy: 'abort-run',
  });
  const remainingLegacyServices = [...input.legacyServices];
  const index = remainingLegacyServices.indexOf(serviceKey);
  if (index >= 0) remainingLegacyServices.splice(index, 1);
  return Object.freeze({ task, operations, remainingLegacyServices: Object.freeze(remainingLegacyServices) });
}
