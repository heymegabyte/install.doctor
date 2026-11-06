#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { canonicalAuthorityBytes, canonicalAuthorityDigest, verifyIndependentPromotionEvidence } from '../packages/installer-engine/dist/offline-authority.js';

const [inputFile, canaryFile, outputFile] = process.argv.slice(2);
if (!inputFile || !canaryFile || !outputFile || process.argv.length !== 5) {
  throw new Error('usage: promote-platform-canary-receipt INPUT CANARY OUTPUT');
}
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  throw new Error('platform promotion requires an independent GitHub-hosted verifier');
}
const readBoundedJson = (file, maximum) => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maximum) throw new Error(`unsafe promotion input: ${file}`);
  return { bytes: fs.readFileSync(file), value: JSON.parse(fs.readFileSync(file, 'utf8')) };
};
const input = readBoundedJson(inputFile, 16_777_216).value;
const canary = readBoundedJson(canaryFile, 16_777_216);
if (canary.value.schemaVersion !== 2 || canary.value.evidenceClass !== 'real-host-canary' || canary.value.result !== 'passed') {
  throw new Error('only an unpromoted passing real-host canary receipt may be promoted');
}
const expected = input.expected ?? {};
const offlineProof = canary.value.proof?.phases?.offlineExecution;
if (canary.value.release?.releaseId !== expected.releaseId || canary.value.release?.manifestDigest !== expected.releaseManifestDigest
  || canary.value.proof?.workflowCommit !== input.ciAttestation?.workflowRevision
  || canary.value.proof?.workflowRunId !== input.ciAttestation?.workflowRunId
  || canary.value.tuple?.arch !== expected.platform?.arch || canary.value.tuple?.environment !== expected.platform?.environment
  || offlineProof?.runId !== input.journal?.runId || offlineProof?.planDigest !== input.request?.normalizedPlanDigest
  || offlineProof?.authorityDigest !== input.executionAuthority?.journalCommitDigest
  || offlineProof?.offlineBundle?.manifestDigest !== input.bundle?.manifestDigest
  || JSON.stringify(offlineProof?.selectedTaskIds) !== JSON.stringify(input.request?.selectedTaskIds)) {
  throw new Error('unpromoted canary does not bind the independently verified release, workflow, platform, plan, journal, and offline bundle');
}
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'install-doctor-promotion-'));
fs.chmodSync(stage, 0o700);
const run = (file, args, stdin) => {
  const result = spawnSync(file, args, { input: stdin, encoding: null, env: { PATH: process.env.PATH ?? '' }, maxBuffer: 1_048_576 });
  return result.status === 0;
};
const verifySshSignature = ({ payloadDigest, signatureBase64, publicKey, keyId, namespace }) => {
  const token = crypto.randomBytes(12).toString('hex');
  const allowed = path.join(stage, `${token}.allowed`); const signature = path.join(stage, `${token}.sig`);
  fs.writeFileSync(allowed, `${keyId} ${publicKey}\n`, { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(signature, Buffer.from(signatureBase64, 'base64'), { mode: 0o600, flag: 'wx' });
  return Promise.resolve(run('ssh-keygen', ['-Y', 'verify', '-f', allowed, '-I', keyId, '-n', namespace, '-s', signature], Buffer.from(`${payloadDigest}\n`)));
};
const verifyGithubAttestation = ({ attestation, signatureBase64 }) => {
  const subject = path.join(stage, 'github-attestation-subject'); const bundle = path.join(stage, 'github-attestation-bundle.json');
  fs.writeFileSync(subject, canonicalAuthorityBytes({ journal: input.journal, executionAuthority: input.executionAuthority }), { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(bundle, Buffer.from(signatureBase64, 'base64'), { mode: 0o600, flag: 'wx' });
  const repository = input.expected?.repository;
  if (repository !== attestation.repository) return Promise.resolve(false);
  return Promise.resolve(run('gh', ['attestation', 'verify', subject, '--repo', repository, '--bundle', bundle,
    '--cert-identity', attestation.subject, '--cert-oidc-issuer', attestation.issuer,
    '--signer-digest', attestation.workflowRevision, '--deny-self-hosted-runners'], Buffer.alloc(0)));
};

try {
  const result = await verifyIndependentPromotionEvidence(input, { verifyDigestSignature: verifySshSignature, verifyCiAttestation: verifyGithubAttestation });
  const canaryDigest = crypto.createHash('sha256').update(canary.bytes).digest('hex');
  const promoted = {
    ...canary.value,
    schemaVersion: 3,
    promotion: {
      schemaVersion: 1, verifier: 'independent-offline-authority', canaryDigest,
      promotionDigest: result.promotionDigest, bindings: result.bindings,
      verifiedAt: input.now,
    },
  };
  const temporary = `${outputFile}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(promoted)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, outputFile);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
