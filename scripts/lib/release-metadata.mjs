import { createHash, createPublicKey, verify } from 'node:crypto';

export const ROLES = Object.freeze(['root', 'targets', 'platform', 'channel', 'snapshot', 'timestamp', 'build', 'publish', 'activate', 'monitor', 'revocation']);
const ROLE_SET = new Set(ROLES);
const idPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const keyPattern = /^[a-f0-9]{64}$/;

const exact = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} has unknown or missing fields`);
  return value;
};
const integer = (value, label, minimum = 1) => {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${label} must be an integer >= ${minimum}`);
};
const identifier = (value, label, nullable = false) => {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !idPattern.test(value)) throw new Error(`${label} is invalid`);
};
const uniqueStrings = (value, label) => {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string') || new Set(value).size !== value.length) throw new Error(`${label} must contain unique strings`);
};
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
};
export const canonicalBytes = (metadata) => Buffer.from(JSON.stringify(canonical({
  schemaVersion: metadata.schemaVersion,
  role: metadata.role,
  version: metadata.version,
  expiresAt: metadata.expiresAt,
  signed: metadata.signed,
})));
export const keyIdFor = (publicKeyPem) => createHash('sha256').update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })).digest('hex');

const validateRootPayload = (payload) => {
  exact(payload, ['keys', 'roles'], 'root payload');
  exact(payload.keys, Object.keys(payload.keys), 'root keys');
  if (Object.keys(payload.keys).length === 0) throw new Error('root keys must not be empty');
  for (const [keyId, key] of Object.entries(payload.keys)) {
    if (!keyPattern.test(keyId)) throw new Error('root key id is invalid');
    exact(key, ['algorithm', 'publicKey'], `root key ${keyId}`);
    if (key.algorithm !== 'ed25519' || typeof key.publicKey !== 'string' || keyIdFor(key.publicKey) !== keyId) throw new Error(`root key ${keyId} is invalid`);
  }
  exact(payload.roles, ROLES, 'root roles');
  for (const role of ROLES) {
    const policy = exact(payload.roles[role], ['keyIds', 'threshold'], `${role} policy`);
    uniqueStrings(policy.keyIds, `${role} keyIds`);
    integer(policy.threshold, `${role} threshold`);
    if (policy.threshold > policy.keyIds.length || policy.keyIds.some((id) => !payload.keys[id])) throw new Error(`${role} threshold policy is unsatisfiable`);
  }
};
const validateDelegatedPayload = (payload, role) => {
  exact(payload, ['parentRole', 'parentVersion', 'parentDigest', 'sequence', 'artifacts', 'claims'], `${role} payload`);
  if (!ROLE_SET.has(payload.parentRole) || payload.parentRole === role) throw new Error(`${role} parent role is invalid`);
  integer(payload.parentVersion, `${role} parentVersion`);
  if (typeof payload.parentDigest !== 'string' || !keyPattern.test(payload.parentDigest)) throw new Error(`${role} parentDigest is invalid`);
  integer(payload.sequence, `${role} sequence`, 0);
  if (!Array.isArray(payload.artifacts)) throw new Error(`${role} artifacts must be an array`);
  for (const artifact of payload.artifacts) {
    exact(artifact, ['name', 'sha256', 'size'], `${role} artifact`);
    identifier(artifact.name, `${role} artifact name`);
    if (!keyPattern.test(artifact.sha256)) throw new Error(`${role} artifact digest is invalid`);
    integer(artifact.size, `${role} artifact size`, 0);
  }
  if (!payload.claims || typeof payload.claims !== 'object' || Array.isArray(payload.claims)) throw new Error(`${role} claims must be an object`);
};

export function validateReleaseMetadata(metadata, options = {}) {
  exact(metadata, ['schemaVersion', 'role', 'version', 'expiresAt', 'signed', 'signatures'], 'metadata');
  if (metadata.schemaVersion !== 1 || !ROLE_SET.has(metadata.role)) throw new Error('unsupported release metadata schema or role');
  integer(metadata.version, 'metadata version');
  const expiry = Date.parse(metadata.expiresAt);
  const now = options.now instanceof Date ? options.now.getTime() : Date.parse(options.now ?? new Date().toISOString());
  if (!Number.isFinite(expiry) || !Number.isFinite(now) || expiry <= now) throw new Error('release metadata is expired or clock is invalid');
  exact(metadata.signed, ['productId', 'role', 'subject', 'payload'], 'signed metadata');
  if (metadata.signed.productId !== 'desktop-tools' || metadata.signed.role !== metadata.role) throw new Error('product or role substitution detected');
  exact(metadata.signed.subject, ['releaseId', 'platform', 'channel'], 'metadata subject');
  for (const field of ['releaseId', 'platform', 'channel']) identifier(metadata.signed.subject[field], `subject ${field}`, true);
  for (const [field, expected] of Object.entries(options.expectedSubject ?? {})) if (metadata.signed.subject[field] !== expected) throw new Error(`subject ${field} substitution detected`);
  if (metadata.role === 'root') validateRootPayload(metadata.signed.payload); else validateDelegatedPayload(metadata.signed.payload, metadata.role);
  const trustedRoot = options.trustedRoot ?? (metadata.role === 'root' ? metadata : undefined);
  if (!trustedRoot) throw new Error('trusted root is required');
  const rootPayload = trustedRoot.signed?.payload;
  validateRootPayload(rootPayload);
  const minimumVersion = options.minimumVersion ?? 0;
  if (metadata.version < minimumVersion) throw new Error('metadata rollback detected');
  if (!Array.isArray(metadata.signatures) || metadata.signatures.length === 0) throw new Error('metadata signatures are missing');
  const policy = rootPayload.roles[metadata.role];
  const bytes = canonicalBytes(metadata);
  const accepted = new Set();
  for (const signature of metadata.signatures) {
    exact(signature, ['keyId', 'algorithm', 'signature'], 'signature');
    if (signature.algorithm !== 'ed25519' || !policy.keyIds.includes(signature.keyId) || accepted.has(signature.keyId)) continue;
    const key = rootPayload.keys[signature.keyId];
    if (verify(null, bytes, key.publicKey, Buffer.from(signature.signature, 'base64url'))) accepted.add(signature.keyId);
  }
  if (accepted.size < policy.threshold) throw new Error(`signature threshold not met for ${metadata.role}`);
  return Object.freeze({ role: metadata.role, version: metadata.version, expiresAt: metadata.expiresAt, acceptedKeyIds: [...accepted].sort() });
}

export function validateRootRotation(currentRoot, nextRoot, options = {}) {
  validateReleaseMetadata(currentRoot, { now: options.now });
  if (nextRoot.role !== 'root' || nextRoot.version !== currentRoot.version + 1) throw new Error('root rotation must advance exactly one version');
  validateReleaseMetadata(nextRoot, { trustedRoot: currentRoot, now: options.now, minimumVersion: currentRoot.version + 1 });
  validateReleaseMetadata(nextRoot, { trustedRoot: nextRoot, now: options.now, minimumVersion: currentRoot.version + 1 });
  const oldIds = new Set(currentRoot.signed.payload.roles.root.keyIds);
  const nextIds = new Set(nextRoot.signed.payload.roles.root.keyIds);
  const overlap = [...oldIds].filter((id) => nextIds.has(id));
  if (overlap.length < currentRoot.signed.payload.roles.root.threshold) throw new Error('root rotation lacks old-threshold overlap');
  if (![...nextIds].some((id) => !oldIds.has(id))) throw new Error('root rotation introduces no new key');
  return Object.freeze({ fromVersion: currentRoot.version, toVersion: nextRoot.version, overlapKeyIds: overlap.sort() });
}

export function validateRevocation(revocation, trustedRoot, options = {}) {
  const result = validateReleaseMetadata(revocation, { trustedRoot, now: options.now, minimumVersion: options.minimumVersion });
  if (revocation.role !== 'revocation') throw new Error('revocation metadata role is required');
  const claims = revocation.signed.payload.claims;
  exact(claims, ['effectiveAt', 'reason', 'revokedKeyIds'], 'revocation claims');
  const effectiveAt = Date.parse(claims.effectiveAt);
  if (!Number.isFinite(effectiveAt) || effectiveAt > Date.parse(options.now ?? new Date().toISOString())) throw new Error('revocation is not effective');
  if (typeof claims.reason !== 'string' || claims.reason.trim().length < 8) throw new Error('revocation reason is insufficient');
  uniqueStrings(claims.revokedKeyIds, 'revoked key ids');
  for (const keyId of claims.revokedKeyIds) {
    if (!keyPattern.test(keyId) || !trustedRoot.signed.payload.keys[keyId]) throw new Error('revocation names an unknown key');
  }
  return Object.freeze({ ...result, revokedKeyIds: [...claims.revokedKeyIds].sort() });
}
