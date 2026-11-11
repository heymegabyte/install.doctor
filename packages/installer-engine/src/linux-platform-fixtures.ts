import { createHash } from 'node:crypto';
import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const version = z.string().min(1).max(64);

export const LinuxFixtureDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  fixtureId: identifier,
  family: z.enum(['debian', 'ubuntu', 'fedora', 'alpine', 'arch', 'container', 'immutable-os', 'wsl']),
  tuple: z.strictObject({
    osId: identifier,
    version,
    architecture: z.enum(['x86_64', 'aarch64']),
    environment: z.enum(['container', 'immutable-os', 'wsl']),
    role: identifier,
  }),
  boundary: z.enum(['oci-container', 'disposable-ostree-vm', 'windows-wsl2']),
  image: z.strictObject({ reference: z.string().min(1).max(512), digest, materialized: z.boolean() }),
  desiredStateDigest: digest,
});

export type LinuxFixtureDefinition = z.infer<typeof LinuxFixtureDefinitionSchema>;

const desiredStateDigest = createHash('sha256').update('desktop-tools/hermetic-linux-fixture/v1\n').digest('hex');

/** Exact platform boundaries owned by the fixture laboratory. A definition is not run evidence. */
export const LINUX_PLATFORM_FIXTURES: readonly LinuxFixtureDefinition[] = [
  { schemaVersion: 1, fixtureId: 'debian-12-x64-container', family: 'debian',
    tuple: { osId: 'debian', version: '12', architecture: 'x86_64', environment: 'container', role: 'debian' },
    boundary: 'oci-container', image: { reference: 'docker.io/library/debian:12', digest: '268fb24c39bca92d326dd83ea3abebe4a3f7751c804ffef23bb6d857dd343ff8', materialized: true }, desiredStateDigest },
  { schemaVersion: 1, fixtureId: 'ubuntu-24.04-x64-container', family: 'ubuntu',
    tuple: { osId: 'ubuntu', version: '24.04', architecture: 'x86_64', environment: 'container', role: 'ubuntu' },
    boundary: 'oci-container', image: { reference: 'docker.io/library/ubuntu:24.04', digest: 'fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852', materialized: true }, desiredStateDigest },
  { schemaVersion: 1, fixtureId: 'fedora-44-x64-container', family: 'fedora',
    tuple: { osId: 'fedora', version: '44', architecture: 'x86_64', environment: 'container', role: 'fedora' },
    boundary: 'oci-container', image: { reference: 'registry.fedoraproject.org/fedora:44', digest: '15da97ed9aa94dd3d92c3925eb89520f6c80e07ea7ee24cba848d1f8b6912b3e', materialized: true }, desiredStateDigest },
  { schemaVersion: 1, fixtureId: 'alpine-3.19-x64-container', family: 'alpine',
    tuple: { osId: 'alpine', version: '3.19', architecture: 'x86_64', environment: 'container', role: 'alpine' },
    boundary: 'oci-container', image: { reference: 'docker.io/library/alpine:3.19', digest: '6baf43584bcb78f2e5847d1de515f23499913ac9f12bdf834811a3145eb11ca1', materialized: true }, desiredStateDigest },
  { schemaVersion: 1, fixtureId: 'arch-rolling-x64-container', family: 'arch',
    tuple: { osId: 'arch', version: 'rolling', architecture: 'x86_64', environment: 'container', role: 'arch' },
    boundary: 'oci-container', image: { reference: 'docker.io/library/archlinux:base', digest: 'b1c2fe6e717bfd5673af8fc217e1e1c3ce0dcbb1d53c3414c8425e7ce79fc6d9', materialized: true }, desiredStateDigest },
  { schemaVersion: 1, fixtureId: 'ubuntu-24.04-x64-container-boundary', family: 'container',
    tuple: { osId: 'ubuntu', version: '24.04', architecture: 'x86_64', environment: 'container', role: 'container' },
    boundary: 'oci-container', image: { reference: 'docker.io/library/ubuntu:24.04', digest: 'fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852', materialized: true }, desiredStateDigest },
  { schemaVersion: 1, fixtureId: 'silverblue-43-x64-ostree', family: 'immutable-os',
    tuple: { osId: 'fedora-silverblue', version: '43', architecture: 'x86_64', environment: 'immutable-os', role: 'silverblue' },
    boundary: 'disposable-ostree-vm', image: { reference: 'ostree://fedora/43/x86_64/silverblue',
      digest: createHash('sha256').update('unmaterialized:ostree://fedora/43/x86_64/silverblue\n').digest('hex'), materialized: false }, desiredStateDigest },
  { schemaVersion: 1, fixtureId: 'ubuntu-24.04-x64-wsl2', family: 'wsl',
    tuple: { osId: 'ubuntu', version: '24.04', architecture: 'x86_64', environment: 'wsl', role: 'wsl' },
    boundary: 'windows-wsl2', image: { reference: 'wsl://ubuntu-24.04',
      digest: createHash('sha256').update('unmaterialized:wsl://ubuntu-24.04\n').digest('hex'), materialized: false }, desiredStateDigest },
].map(definition => LinuxFixtureDefinitionSchema.parse(definition));

export const LinuxFixtureInfrastructureSchema = z.strictObject({
  availableBoundaries: z.array(z.enum(['oci-container', 'disposable-ostree-vm', 'windows-wsl2'])).max(3),
  imageDigests: z.record(z.string(), digest),
});

export const LinuxFixtureBlockerSchema = z.strictObject({
  schemaVersion: z.literal(1), fixtureId: identifier, status: z.literal('BLOCKED'),
  code: z.enum(['OCI_RUNTIME_UNAVAILABLE', 'OSTREE_FIXTURE_UNAVAILABLE', 'WINDOWS_WSL2_FIXTURE_UNAVAILABLE', 'FIXTURE_IMAGE_UNAVAILABLE']),
  missingPrerequisite: z.string().min(1).max(256), detail: z.string().min(1).max(1024),
  remediation: z.string().min(1).max(1024), promotesSupport: z.literal(false),
});

export type LinuxFixtureBlocker = z.infer<typeof LinuxFixtureBlockerSchema>;

const blockers = {
  'oci-container': ['OCI_RUNTIME_UNAVAILABLE', 'digest-pinned OCI container runtime',
    'No admitted OCI runtime is available to create the exact disposable Linux container.',
    'Provide Docker or Podman with permission to run the digest-pinned fixture image.'],
  'disposable-ostree-vm': ['OSTREE_FIXTURE_UNAVAILABLE', 'disposable OSTree virtual machine',
    'No disposable rpm-ostree or bootc virtual machine is available; a mutable distribution or mock is not equivalent.',
    'Attach an authorized disposable OSTree VM and independently attest its image digest.'],
  'windows-wsl2': ['WINDOWS_WSL2_FIXTURE_UNAVAILABLE', 'Windows-hosted disposable WSL2 distribution',
    'No Windows-hosted WSL2 laboratory is available; a Linux container cannot prove host/guest, mount, init, or restart semantics.',
    'Attach an authorized disposable Windows host with the exact imported WSL2 image.'],
} as const;

export function admitLinuxFixtureInfrastructure(definitionInput: unknown, infrastructureInput: unknown):
  { status: 'READY'; definition: LinuxFixtureDefinition } | LinuxFixtureBlocker {
  const definition = LinuxFixtureDefinitionSchema.parse(definitionInput);
  const infrastructure = LinuxFixtureInfrastructureSchema.parse(infrastructureInput);
  if (!definition.image.materialized) {
    const [code, missingPrerequisite, detail, remediation] = blockers[definition.boundary];
    return LinuxFixtureBlockerSchema.parse({ schemaVersion: 1, fixtureId: definition.fixtureId, status: 'BLOCKED',
      code, missingPrerequisite, detail, remediation, promotesSupport: false });
  }
  if (!infrastructure.availableBoundaries.includes(definition.boundary)) {
    const [code, missingPrerequisite, detail, remediation] = blockers[definition.boundary];
    return LinuxFixtureBlockerSchema.parse({ schemaVersion: 1, fixtureId: definition.fixtureId, status: 'BLOCKED',
      code, missingPrerequisite, detail, remediation, promotesSupport: false });
  }
  if (infrastructure.imageDigests[definition.image.reference] !== definition.image.digest) {
    return LinuxFixtureBlockerSchema.parse({ schemaVersion: 1, fixtureId: definition.fixtureId, status: 'BLOCKED',
      code: 'FIXTURE_IMAGE_UNAVAILABLE', missingPrerequisite: `exact image ${definition.image.reference}@sha256:${definition.image.digest}`,
      detail: 'The admitted boundary does not contain the exact immutable fixture image; tags and different bytes are rejected.',
      remediation: 'Materialize and independently verify the exact fixture digest before execution.', promotesSupport: false });
  }
  return { status: 'READY', definition };
}

export const LinuxFixtureObservationSchema = z.strictObject({
  fixtureId: identifier, boundary: z.enum(['oci-container', 'disposable-ostree-vm', 'windows-wsl2']),
  disposable: z.literal(true), imageDigest: digest, osId: identifier, version,
  architecture: z.enum(['x86_64', 'aarch64']), environment: z.enum(['container', 'immutable-os', 'wsl']),
  role: identifier, infrastructureEvidenceDigest: digest,
});

export type LinuxFixtureState = { desiredStateDigest?: string; mutationCount: number };
export type LinuxFixtureAdapter = {
  discover(): LinuxFixtureState;
  apply(desiredStateDigest: string): { state: LinuxFixtureState; mutated: boolean };
};

export const LinuxFixtureLifecycleReceiptSchema = z.strictObject({
  schemaVersion: z.literal(1), fixtureId: identifier, evidenceClass: z.literal('hermetic-semantic-fixture'),
  imageDigest: digest, infrastructureEvidenceDigest: digest, desiredStateDigest: digest, result: z.literal('passed'),
  cleanInstall: z.strictObject({ mutated: z.literal(true), mutationDelta: z.literal(1) }),
  unchangedReapply: z.strictObject({ mutated: z.literal(false), mutationDelta: z.literal(0) }),
  promotesSupport: z.literal(false),
});

/** Proves semantic idempotency only; it can never promote a real support cell. */
export function verifyLinuxFixtureLifecycle(definitionInput: unknown, observationInput: unknown,
  adapter: LinuxFixtureAdapter): z.infer<typeof LinuxFixtureLifecycleReceiptSchema> {
  const definition = LinuxFixtureDefinitionSchema.parse(definitionInput);
  if (!definition.image.materialized) throw new Error('fixture image is not materialized; emit the infrastructure blocker');
  const observation = LinuxFixtureObservationSchema.parse(observationInput);
  const expected = { fixtureId: definition.fixtureId, boundary: definition.boundary, imageDigest: definition.image.digest,
    ...definition.tuple };
  for (const [key, value] of Object.entries(expected)) {
    if (observation[key as keyof typeof observation] !== value) throw new Error(`fixture observation mismatch: ${key}`);
  }
  const before = adapter.discover();
  if (before.desiredStateDigest !== undefined) throw new Error('clean-install fixture is not clean');
  const clean = adapter.apply(definition.desiredStateDigest);
  const cleanDelta = clean.state.mutationCount - before.mutationCount;
  if (!clean.mutated || cleanDelta !== 1 || clean.state.desiredStateDigest !== definition.desiredStateDigest) {
    throw new Error('clean install did not make exactly one attributable desired-state mutation');
  }
  const reapplied = adapter.apply(definition.desiredStateDigest);
  const reapplyDelta = reapplied.state.mutationCount - clean.state.mutationCount;
  if (reapplied.mutated || reapplyDelta !== 0 || reapplied.state.desiredStateDigest !== definition.desiredStateDigest) {
    throw new Error('unchanged reapply was not a verified no-op');
  }
  return LinuxFixtureLifecycleReceiptSchema.parse({ schemaVersion: 1, fixtureId: definition.fixtureId,
    evidenceClass: 'hermetic-semantic-fixture', imageDigest: definition.image.digest,
    infrastructureEvidenceDigest: observation.infrastructureEvidenceDigest, desiredStateDigest: definition.desiredStateDigest,
    result: 'passed', cleanInstall: { mutated: true, mutationDelta: 1 },
    unchangedReapply: { mutated: false, mutationDelta: 0 }, promotesSupport: false });
}
