/**
 * Source-pinned release trust anchors.
 *
 * Add a public key only after its private counterpart has an approved custody,
 * rotation, and recovery procedure. Deployment configuration may select a key
 * id, but may never inject or replace the trust anchor itself.
 */
import trust from './release-trust.json';
import { z } from 'zod';
import { ReleaseProduct, releasePolicy } from './release-policy.ts';

const signerId = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/);
const publicKey = z.string().regex(/^ssh-ed25519 [A-Za-z0-9+/]+={0,3}(?: [^\r\n]{1,128})?$/);
const productTrust = z.strictObject({ origin: z.string().url(), signatureNamespace: z.string().min(1), signers: z.record(signerId, publicKey) });
const parsed = z.strictObject({ schemaVersion: z.literal(2), products: z.strictObject({
  'legacy-install-doctor': productTrust, 'desktop-tools': productTrust
}) }).parse(trust);
for (const product of ReleaseProduct.options) {
  const policy = releasePolicy(product);
  const configured = parsed.products[product];
  if (configured.origin !== policy.origin || configured.signatureNamespace !== policy.signatureNamespace) {
    throw new Error(`release trust policy mismatch: ${product}`);
  }
}

export function pinnedReleaseSigner(productInput: unknown, keyId: string | undefined): string | undefined {
  const product = ReleaseProduct.safeParse(productInput);
  if (!product.success) return undefined;
  if (!keyId || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(keyId)) return undefined;
  return parsed.products[product.data].signers[keyId];
}
