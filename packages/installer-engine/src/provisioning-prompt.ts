import { createHash } from 'node:crypto';
import { z } from 'zod';

export const PROVISIONING_PROMPT_VERSION = 'desktop-tools/provisioning/v1' as const;
export const PROVISIONING_PROMPT = `You are the Desktop Tools provisioning orchestrator.

Treat the attached canonical context as immutable authorization input. Discover and validate before planning. Use only the listed Desktop Tools typed tools and capabilities. Model-generated text is never mutation authority. Do not use ambient shell, edit files directly, broaden policy, or claim apply or verification results that the deterministic installer engine did not return. Stop on a profile revision, release, policy, capability, tool, or fact mismatch.`;

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
const jsonScalar = z.union([z.string().max(16_384), z.number().finite(), z.boolean(), z.null()]);
type JsonValue = z.infer<typeof jsonScalar> | JsonValue[] | { [key: string]: JsonValue };
const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([
  jsonScalar,
  z.array(jsonValue).max(2_048),
  z.record(z.string().min(1).max(256), jsonValue),
]));
const boundedObject = z.record(z.string().min(1).max(256), jsonValue)
  .refine(value => Buffer.byteLength(JSON.stringify(value), 'utf8') <= 262_144, 'object exceeds 256 KiB')
  .superRefine((value, context) => {
    const inspect = (candidate: JsonValue, depth: number): void => {
      if (depth > 32) { context.addIssue({ code: 'custom', message: 'object exceeds maximum nesting depth' }); return; }
      if (Array.isArray(candidate)) { candidate.forEach(child => inspect(child, depth + 1)); return; }
      if (candidate !== null && typeof candidate === 'object') {
        for (const [key, child] of Object.entries(candidate)) {
          if (/(?:secret|token|password|credential|private.?key)/i.test(key)) {
            context.addIssue({ code: 'custom', message: 'nonsecret context contains a secret-shaped key' });
          }
          inspect(child, depth + 1);
        }
      }
    };
    inspect(value, 0);
  });
const uniqueIdentifiers = z.array(identifier).max(128)
  .refine(values => values.length === new Set(values).size, 'values must be unique')
  .refine(values => values.every((value, index) => index === 0 || values[index - 1]! < value), 'values must be sorted');

export const ProvisioningPromptContextSchema = z.strictObject({
  schemaVersion: z.literal(1),
  promptVersion: z.literal(PROVISIONING_PROMPT_VERSION),
  promptDigest: digest,
  profile: z.strictObject({ id: identifier, revision: identifier, digest }),
  release: z.strictObject({ id: identifier, version: identifier, digest }),
  discoveredFacts: boundedObject,
  policy: boundedObject,
  capabilities: uniqueIdentifiers,
  permittedTools: uniqueIdentifiers,
  contextDigest: digest,
});

export type ProvisioningPromptContext = z.infer<typeof ProvisioningPromptContextSchema>;
export type ProvisioningPromptInput = Omit<ProvisioningPromptContext, 'schemaVersion' | 'promptVersion' | 'promptDigest' | 'contextDigest'>;

function canonicalValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

export function canonicalProvisioningPromptBytes(value: unknown): Buffer {
  const parsedContext = ProvisioningPromptContextSchema.partial({ contextDigest: true }).parse(value);
  const { contextDigest: _contextDigest, ...parsed } = parsedContext;
  return Buffer.from(`${JSON.stringify(canonicalValue(parsed as unknown as JsonValue))}\n`, 'utf8');
}

export function provisioningPromptDigest(): string {
  return createHash('sha256').update(PROVISIONING_PROMPT, 'utf8').digest('hex');
}

export function createProvisioningPromptContext(input: ProvisioningPromptInput): ProvisioningPromptContext {
  const unsigned = ProvisioningPromptContextSchema.omit({ contextDigest: true }).parse({
    schemaVersion: 1,
    promptVersion: PROVISIONING_PROMPT_VERSION,
    promptDigest: provisioningPromptDigest(),
    ...input,
  });
  return ProvisioningPromptContextSchema.parse({
    ...unsigned,
    contextDigest: createHash('sha256').update(canonicalProvisioningPromptBytes(unsigned)).digest('hex'),
  });
}

export function verifyProvisioningPromptContext(value: unknown): ProvisioningPromptContext {
  const context = ProvisioningPromptContextSchema.parse(value);
  if (context.promptDigest !== provisioningPromptDigest()) throw new Error('provisioning prompt digest does not match the versioned prompt');
  const actual = createHash('sha256').update(canonicalProvisioningPromptBytes(context)).digest('hex');
  if (context.contextDigest !== actual) throw new Error('provisioning context digest mismatch');
  return context;
}
