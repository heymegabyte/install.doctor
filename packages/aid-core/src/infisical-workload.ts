/** Pure least-privilege contracts for Infisical workload secret delivery. */
import { z } from 'zod';

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/);
const secretName = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/);
const environmentVariable = z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/);

const principalSchema = z.object({
  kind: z.enum(['public-human', 'ci', 'service', 'local-offline-human', 'product-customer']),
  authMode: z.enum(['oidc', 'workload-identity', 'universal-auth', 'native']),
  provider: z.enum(['cloudflare-access', 'github', 'native', 'infisical', 'authentik', 'product-native'])
}).strict().superRefine((principal, context) => {
  const allowed = new Set([
    'public-human:oidc:cloudflare-access', 'ci:oidc:github', 'ci:oidc:native',
    'service:workload-identity:infisical', 'service:universal-auth:infisical', 'local-offline-human:oidc:authentik',
    'product-customer:native:product-native'
  ]);
  if (!allowed.has(`${principal.kind}:${principal.authMode}:${principal.provider}`)) {
    context.addIssue({ code: 'custom', message: 'Principal violates the identity plane' });
  }
});

const workloadSchema = z.object({
  id: identifier,
  identityId: identifier,
  projectId: identifier,
  environment: z.literal('prod'),
  secretPath: z.string().regex(/^\/workloads\/[a-z0-9][a-z0-9._-]{0,95}$/, 'Expected a fixed workload leaf path'),
  principal: principalSchema,
  delivery: z.literal('environment'),
  secrets: z.array(z.object({ secretName, environmentVariable }).strict()).min(1).max(256)
}).strict().superRefine((workload, context) => {
  if (workload.secretPath !== `/workloads/${workload.id}`) context.addIssue({ code: 'custom', message: 'Workload id and fixed leaf path must match' });
  const names = workload.secrets.map(item => item.secretName);
  const variables = workload.secrets.map(item => item.environmentVariable);
  if (new Set(names).size !== names.length || new Set(variables).size !== variables.length) {
    context.addIssue({ code: 'custom', message: 'Every secret mapping must be exact and unique' });
  }
});

const manifestSchema = z.object({ schemaVersion: z.literal(1), workloads: z.array(workloadSchema).min(1).max(10_000) }).strict()
  .superRefine((manifest, context) => {
    const ids = manifest.workloads.map(item => item.id);
    const identities = manifest.workloads.map(item => item.identityId);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: 'Workload ids must be unique' });
    if (new Set(identities).size !== identities.length) context.addIssue({ code: 'custom', message: 'Each workload requires one unshared identity' });
  });

export type InfisicalWorkloadManifest = z.infer<typeof manifestSchema>;

/** Validates a versioned manifest without resolving or exposing any secret value. */
export function validateInfisicalWorkloadManifest(input: unknown): InfisicalWorkloadManifest {
  return manifestSchema.parse(input);
}
