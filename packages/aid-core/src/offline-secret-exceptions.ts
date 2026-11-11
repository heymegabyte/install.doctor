/** Value-free inventory and eligibility rules for exceptional local secret material. */
import { z } from 'zod';

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const date = z.string().date();
const storePath = z.string().regex(/^home\/\.chezmoitemplates\/secrets(?:-[a-z0-9-]+)?$/);

export const offlineSecretPurposes = ['pre-network', 'boot', 'offline-execution', 'independent-recovery'] as const;

const storeSchema = z.object({
  path: storePath,
  fileCount: z.number().int().nonnegative(),
  filenameSetSha256: z.string().regex(/^[a-f0-9]{64}$/),
  protection: z.literal('age-encrypted-chezmoi-store'),
  undeclaredDisposition: z.literal('infisical-migration-required'),
}).strict();

const exceptionSchema = z.object({
  id: identifier,
  purpose: z.enum(offlineSecretPurposes),
  owner: identifier,
  consumer: identifier,
  requiredWithoutNetwork: z.literal(true),
  protection: z.enum(['age-encrypted-chezmoi-store', 'os-credential-store', 'encrypted-recovery-envelope']),
  reviewAfter: date,
  rotationDays: z.number().int().positive().max(3650),
  observedLocations: z.array(z.string().regex(/^home\/\.chezmoitemplates\/secrets(?:-[a-z0-9-]+)?\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)).max(64),
}).strict();

const inventorySchema = z.object({
  schemaVersion: z.literal(1),
  observedAt: date,
  stores: z.array(storeSchema).min(1).max(128),
  exceptions: z.array(exceptionSchema).min(1).max(4096),
}).strict().superRefine((inventory, context) => {
  const storePaths = inventory.stores.map(store => store.path);
  const ids = inventory.exceptions.map(exception => exception.id);
  if (new Set(storePaths).size !== storePaths.length) context.addIssue({ code: 'custom', message: 'Offline secret store paths must be unique' });
  if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Offline secret exception ids must be unique' });
  const stores = new Set(storePaths);
  for (const exception of inventory.exceptions) {
    for (const location of exception.observedLocations) {
      const slash = location.lastIndexOf('/');
      if (!stores.has(location.slice(0, slash))) context.addIssue({ code: 'custom', message: `Observed location for ${exception.id} is outside an inventoried store` });
      if (location.slice(slash + 1) !== exception.id) context.addIssue({ code: 'custom', message: `Observed location for ${exception.id} has a different secret name` });
    }
  }
});

export type OfflineSecretExceptionInventory = z.infer<typeof inventorySchema>;

/** Validate metadata only. Secret values and hosted secret-store locations are never accepted. */
export function validateOfflineSecretExceptionInventory(input: unknown): OfflineSecretExceptionInventory {
  return inventorySchema.parse(input);
}

/** Local resolution is eligible only when the exact secret id has a reviewed exception. */
export function eligibleOfflineSecretIds(input: unknown): string[] {
  return validateOfflineSecretExceptionInventory(input).exceptions.map(exception => exception.id).sort();
}
