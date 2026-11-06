/**
 * Source-pinned release trust anchors.
 *
 * Add a public key only after its private counterpart has an approved custody,
 * rotation, and recovery procedure. Deployment configuration may select a key
 * id, but may never inject or replace the trust anchor itself.
 */
import trust from './release-trust.json';

const RELEASE_SIGNERS: Readonly<Record<string, string>> = Object.freeze(trust.signers);

export function pinnedReleaseSigner(keyId: string | undefined): string | undefined {
  if (!keyId || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(keyId)) return undefined;
  return RELEASE_SIGNERS[keyId];
}
