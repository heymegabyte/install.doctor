import { z } from 'zod';
import { InstallerEffectClassSchema } from './config-transaction.js';
import { TypedOperationSchema } from '@install-doctor/aid-core/installer-contracts';

const VERSION = z.literal(1);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const repositoryPath = z.string().min(1).max(4096).refine(value => !value.startsWith('/') && !value.split('/').includes('..'), 'repository path must be relative and contained');
const requiredEvidence = z.strictObject({ id, testId: id, description: z.string().min(1).max(1024) });

export const EffectMigrationManifestSchema = z.strictObject({
  schemaVersion: VERSION,
  effectId: id,
  effectClass: InstallerEffectClassSchema,
  legacyOwner: z.strictObject({ path: repositoryPath, mutation: z.string().min(1).max(1024) }),
  engineOwner: z.strictObject({ operationIds: z.array(id).min(1).max(128) }),
  preconditions: z.array(requiredEvidence).min(1).max(128),
  postconditions: z.array(requiredEvidence).min(1).max(128),
  lockDomains: z.array(id).min(1).max(64),
  interruptionTests: z.strictObject({ beforeMutation: id, duringMutation: id, afterMutation: id, resume: id }),
  rollback: z.strictObject({
    automatic: z.boolean(),
    supportedEffects: z.array(InstallerEffectClassSchema).max(7),
    excludedEffects: z.array(InstallerEffectClassSchema).min(1).max(7),
    testId: id,
    limits: z.string().min(1).max(2048),
  }),
  parity: z.strictObject({ fixtureIds: z.array(id).min(1).max(128), testId: id }),
  legacySubtraction: z.strictObject({ path: repositoryPath, assertion: z.string().min(1).max(1024), testId: id }),
}).superRefine((value, context) => {
  const unique = (values: readonly string[], path: (string | number)[]) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', path, message: 'values must be unique' });
  };
  unique(value.engineOwner.operationIds, ['engineOwner', 'operationIds']);
  unique(value.preconditions.map(item => item.id), ['preconditions']);
  unique(value.postconditions.map(item => item.id), ['postconditions']);
  unique(value.lockDomains, ['lockDomains']);
  unique(value.parity.fixtureIds, ['parity', 'fixtureIds']);
  if (value.rollback.automatic && value.effectClass !== 'installer-configuration' && value.effectClass !== 'service-state') {
    context.addIssue({ code: 'custom', path: ['rollback', 'automatic'], message: 'only configuration and service state may declare automatic rollback' });
  }
  if (value.rollback.supportedEffects.includes(value.effectClass) === false) {
    context.addIssue({ code: 'custom', path: ['rollback', 'supportedEffects'], message: 'the migrated effect class must be explicitly classified' });
  }
  if (value.rollback.excludedEffects.some(effect => value.rollback.supportedEffects.includes(effect))) {
    context.addIssue({ code: 'custom', path: ['rollback'], message: 'supported and excluded rollback effects must not overlap' });
  }
});
export type EffectMigrationManifest = z.infer<typeof EffectMigrationManifestSchema>;

export function verifyEffectMigration(
  manifestInput: unknown,
  operationsInput: readonly unknown[],
  passingTestIdsInput: readonly string[],
): EffectMigrationManifest {
  const manifest = EffectMigrationManifestSchema.parse(manifestInput);
  const operations = operationsInput.map(operation => TypedOperationSchema.parse(operation));
  const byId = new Map(operations.map(operation => [operation.id, operation]));
  const missingOperations = manifest.engineOwner.operationIds.filter(operationId => !byId.has(operationId));
  if (missingOperations.length > 0) throw new Error(`migration is missing typed operations: ${missingOperations.join(', ')}`);
  const actualLocks = new Set(manifest.engineOwner.operationIds.flatMap(operationId => byId.get(operationId)?.locks.map(lock => lock.domain) ?? []));
  const missingLocks = manifest.lockDomains.filter(domain => !actualLocks.has(domain));
  if (missingLocks.length > 0) throw new Error(`migration operations are missing declared locks: ${missingLocks.join(', ')}`);
  const actualPostconditions = new Set(manifest.engineOwner.operationIds.flatMap(operationId => byId.get(operationId)?.postconditions.map(item => item.id) ?? []));
  const missingPostconditions = manifest.postconditions.map(item => item.id).filter(conditionId => !actualPostconditions.has(conditionId));
  if (missingPostconditions.length > 0) throw new Error(`migration operations are missing declared postconditions: ${missingPostconditions.join(', ')}`);
  const requiredTests = new Set([
    ...manifest.preconditions.map(item => item.testId),
    ...manifest.postconditions.map(item => item.testId),
    ...Object.values(manifest.interruptionTests),
    manifest.rollback.testId,
    manifest.parity.testId,
    manifest.legacySubtraction.testId,
  ]);
  const passingTests = new Set(passingTestIdsInput.map(value => id.parse(value)));
  const missingTests = [...requiredTests].filter(testId => !passingTests.has(testId)).sort();
  if (missingTests.length > 0) throw new Error(`migration evidence is incomplete: ${missingTests.join(', ')}`);
  return Object.freeze(manifest);
}
