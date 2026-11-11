/** Value-free identity authority contracts for every Desktop Tools workload class. */
import { z } from 'zod';

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/);
const secretName = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/);
const scopeSegment = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/);

export const identityKinds = ['host', 'service', 'ci', 'platform', 'agent', 'maintenance', 'recovery'] as const;

const authorizationSchema = z.object({
  tenant: scopeSegment,
  project: scopeSegment,
  environment: scopeSegment,
  path: z.string().regex(/^\/[a-z0-9._-]+(?:\/[a-z0-9._-]+)*$/, 'Expected one exact absolute leaf path'),
  actions: z.array(z.enum(['read-secret', 'issue-token', 'rotate-secret', 'revoke-secret', 'read-recovery-secret'])).min(1).max(5),
  secretNames: z.array(secretName).min(1).max(256),
  inheritedGrants: z.tuple([]),
}).strict().superRefine((authorization, context) => {
  if (new Set(authorization.actions).size !== authorization.actions.length) context.addIssue({ code: 'custom', message: 'Identity actions must be exact and unique' });
  if (new Set(authorization.secretNames).size !== authorization.secretNames.length) context.addIssue({ code: 'custom', message: 'Secret names must be exact and unique' });
});

const identitySchema = z.object({
  id: identifier,
  kind: z.enum(identityKinds),
  identityId: identifier,
  consumer: z.object({ id: identifier, runtime: identifier }).strict(),
  authority: z.literal('infisical'),
  authentication: z.object({
    mode: z.enum(['github-oidc', 'platform-oidc', 'workload-identity', 'universal-auth']),
    issuer: z.string().url(),
    tokenTtlSeconds: z.number().int().positive().max(86_400),
    tokenMaxUses: z.number().int().positive().max(10_000),
  }).strict(),
  authorization: authorizationSchema,
  delivery: z.object({
    mode: z.enum(['environment', 'runtime-file', 'service-credential']),
    recursive: z.literal(false),
    includeImports: z.literal(false),
    durablePlaintextCache: z.literal(false),
  }).strict(),
}).strict().superRefine((identity, context) => {
  const expectedPath = `/workloads/${identity.kind}/${identity.consumer.id}`;
  if (identity.authorization.path !== expectedPath) context.addIssue({ code: 'custom', message: `Identity path must equal its fixed consumer leaf ${expectedPath}` });
  const recoveryAction = identity.authorization.actions.includes('read-recovery-secret');
  if (recoveryAction !== (identity.kind === 'recovery')) context.addIssue({ code: 'custom', message: 'Recovery secret access belongs only to recovery identities' });
});

const manifestSchema = z.object({ schemaVersion: z.literal(1), identities: z.array(identitySchema).min(1).max(10_000) }).strict()
  .superRefine((manifest, context) => {
    const ids = manifest.identities.map(identity => identity.id);
    const identityIds = manifest.identities.map(identity => identity.identityId);
    const consumers = manifest.identities.map(identity => `${identity.kind}:${identity.consumer.id}`);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Identity manifest ids must be unique' });
    if (new Set(identityIds).size !== identityIds.length) context.addIssue({ code: 'custom', message: 'Shared identities are forbidden' });
    if (new Set(consumers).size !== consumers.length) context.addIssue({ code: 'custom', message: 'Every intended consumer has exactly one identity' });
  });

const estateManifestSchema = manifestSchema.superRefine((manifest, context) => {
  const present = new Set(manifest.identities.map(identity => identity.kind));
  for (const kind of identityKinds) if (!present.has(kind)) context.addIssue({ code: 'custom', message: `Identity estate is missing the ${kind} class` });
});

export type IdentityAuthorityManifest = z.infer<typeof manifestSchema>;

/** Validate one or more identities without resolving credentials or secret values. */
export function validateIdentityAuthorityManifest(input: unknown): IdentityAuthorityManifest { return manifestSchema.parse(input); }

/** Validate a complete estate inventory containing every required identity class. */
export function validateIdentityAuthorityEstate(input: unknown): IdentityAuthorityManifest { return estateManifestSchema.parse(input); }
