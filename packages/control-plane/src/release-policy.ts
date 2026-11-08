import { z } from 'zod';

export const ReleaseProduct = z.enum(['legacy-install-doctor', 'desktop-tools']);
export type ReleaseProduct = z.infer<typeof ReleaseProduct>;

export interface ReleasePolicy {
  product: ReleaseProduct;
  origin: 'https://app.install.doctor' | 'https://desktop.tools';
  signatureNamespace: 'install.doctor.release' | 'desktop.tools.release';
  renewalNamespace: 'install.doctor.release-renewal-plan' | 'desktop.tools.release-renewal-plan';
  engineFilename: 'install-doctor-engine.mjs' | 'desktop-tools-engine.mjs';
  stagePrefix: 'install-doctor' | 'desktop-tools';
  diagnosticName: 'install.doctor' | 'desktop.tools';
}

const policies: Readonly<Record<ReleaseProduct, ReleasePolicy>> = Object.freeze({
  'legacy-install-doctor': Object.freeze({
    product: 'legacy-install-doctor', origin: 'https://app.install.doctor',
    signatureNamespace: 'install.doctor.release', renewalNamespace: 'install.doctor.release-renewal-plan',
    engineFilename: 'install-doctor-engine.mjs', stagePrefix: 'install-doctor', diagnosticName: 'install.doctor'
  }),
  'desktop-tools': Object.freeze({
    product: 'desktop-tools', origin: 'https://desktop.tools',
    signatureNamespace: 'desktop.tools.release', renewalNamespace: 'desktop.tools.release-renewal-plan',
    engineFilename: 'desktop-tools-engine.mjs', stagePrefix: 'desktop-tools', diagnosticName: 'desktop.tools'
  })
});

/** Resolve only one source-owned policy; origins and SSHSIG namespaces are never caller supplied. */
export function releasePolicy(input: unknown): ReleasePolicy {
  return policies[ReleaseProduct.parse(input)];
}

export function releaseObjectUrl(policyInput: unknown, releaseId: string, filename: string): string {
  const policy = releasePolicy(policyInput);
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(releaseId)) throw new Error('invalid release identifier');
  const allowed = ['manifest', 'manifest.sig', 'provision.sh', policy.engineFilename, 'catalog.json', 'start',
    'node-macos-x64.tar.gz', 'node-macos-arm64.tar.gz', 'node-linux-x64.tar.gz', 'node-linux-arm64.tar.gz'];
  if (policy.product === 'desktop-tools') allowed.push(
    'opencode-macos-x64.zip', 'opencode-macos-arm64.zip', 'opencode-linux-x64.tar.gz', 'opencode-linux-arm64.tar.gz',
    'desktop-tools-supervisor.mjs', 'desktop-tools-tools.tar.gz', 'release.sbom.json', 'release.provenance.json',
    'THIRD_PARTY_LICENSES.txt', 'opencode.lock.json');
  if (!allowed.includes(filename)) throw new Error('release filename is outside policy');
  return `${policy.origin}/releases/${releaseId}/${filename}`;
}
