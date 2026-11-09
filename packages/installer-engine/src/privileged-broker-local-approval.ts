import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import {
  PrivilegedBrokerApprovalEvidenceSchema,
  PrivilegedBrokerGrantSchema,
  privilegedBrokerDigest,
} from './privileged-broker-protocol.js';
import type { PrivilegedBrokerApprovalEvidence, PrivilegedBrokerGrant } from './privileged-broker-protocol.js';

const MAX_CONFIRMATION_BYTES = 256;
const CONFIRMATION_TIMEOUT_MS = 120_000;

export interface TrustedLocalConfirmation {
  readonly confirm: (summary: string, exactPhrase: string) => Promise<boolean>;
}

function exactBinding(grant: PrivilegedBrokerGrant) {
  return {
    grantId: grant.grantId,
    grantDigest: privilegedBrokerDigest(grant),
    hostId: grant.hostId,
    releaseId: grant.releaseId,
    runId: grant.runId,
    planDigest: grant.planDigest,
    enrolledUid: grant.enrolledUid,
    brokerExecutableDigest: grant.brokerExecutableDigest,
    runtimeDigest: grant.runtimeDigest,
    workerDigest: grant.workerDigest,
    descriptorDigest: grant.descriptorDigest,
    closureDigest: grant.closureDigest,
    consentDigest: grant.consentDigest,
  } as const;
}

async function confirmOnControllingTerminal(summary: string, exactPhrase: string): Promise<boolean> {
  const terminal = await open('/dev/tty', constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
  try {
    const metadata = await terminal.stat();
    if (!metadata.isCharacterDevice()) throw new Error('trusted local approval requires a controlling terminal');
    await terminal.write(`${summary}\n\nType exactly: ${exactPhrase}\n> `);
    const bytes = Buffer.alloc(MAX_CONFIRMATION_BYTES + 1);
    let length = 0;
    const deadline = Date.now() + CONFIRMATION_TIMEOUT_MS;
    while (length <= MAX_CONFIRMATION_BYTES) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('trusted local approval timed out');
      const read = terminal.read(bytes, length, 1, null);
      const timeout = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('trusted local approval timed out')), remaining);
        timer.unref();
      });
      const { bytesRead } = await Promise.race([read, timeout]);
      if (bytesRead === 0) throw new Error('trusted local approval terminal closed');
      if (bytes[length] === 0x0a || bytes[length] === 0x0d) break;
      length += bytesRead;
    }
    if (length > MAX_CONFIRMATION_BYTES) throw new Error('trusted local approval response is too long');
    return bytes.subarray(0, length).toString('utf8') === exactPhrase;
  } finally {
    await terminal.close();
  }
}

/**
 * Performs the offline-capable approval ceremony inside the signed root-side
 * lifecycle process. Caller-provided consent files are deliberately ignored.
 */
export async function requestTrustedLocalBrokerApproval(input: {
  readonly grant: unknown;
  readonly now?: () => Date;
  readonly randomNonce?: () => string;
  readonly confirmation?: TrustedLocalConfirmation;
  /** Test seam; production callers must omit this. */
  readonly rootAuthority?: () => boolean;
}): Promise<{ readonly approval: PrivilegedBrokerApprovalEvidence; readonly verify: (candidate: PrivilegedBrokerApprovalEvidence) => Promise<boolean> }> {
  const hasRootAuthority = input.rootAuthority?.() ?? (process.platform === 'linux' && process.geteuid?.() === 0);
  if (!hasRootAuthority) {
    throw new Error('trusted local broker approval requires Linux root authority');
  }
  const grant = PrivilegedBrokerGrantSchema.parse(input.grant);
  const now = input.now?.() ?? new Date();
  if (now.getTime() < Date.parse(grant.issuedAt) || now.getTime() >= Date.parse(grant.expiresAt)) {
    throw new Error('trusted local broker approval requires a currently valid grant');
  }
  const binding = exactBinding(grant);
  const exactPhrase = `authorize ${binding.grantDigest.slice(-16)}`;
  const summary = [
    'Desktop Tools privileged operation approval',
    `Host: ${grant.hostId}`,
    `Release: ${grant.releaseId}`,
    `Run: ${grant.runId}`,
    `Plan: ${grant.planDigest}`,
    `Operations: ${grant.operations.map(operation => `${operation.taskId}/${operation.phase}`).join(', ')}`,
    `Expires: ${grant.expiresAt}`,
  ].join('\n');
  const confirmation = input.confirmation ?? { confirm: confirmOnControllingTerminal };
  if (!await confirmation.confirm(summary, exactPhrase)) throw new Error('trusted local broker approval was denied');
  const challengeNonce = input.randomNonce?.() ?? randomBytes(32).toString('base64url');
  const approvedAt = now.toISOString();
  const confirmationDigest = privilegedBrokerDigest({ binding, challengeNonce, approvedAt, exactPhrase });
  const approval = PrivilegedBrokerApprovalEvidenceSchema.parse({
    schemaVersion: 1,
    approvalId: `local-${challengeNonce.slice(0, 24).toLowerCase()}`,
    method: 'trusted-local',
    ...binding,
    evidenceDigest: privilegedBrokerDigest({ method: 'trusted-local', binding, challengeNonce, confirmationDigest, approvedAt }),
    approvedAt,
    proof: { challengeNonce, confirmationDigest },
  });
  const expectedDigest = privilegedBrokerDigest(approval);
  return Object.freeze({
    approval,
    verify: async (candidate: PrivilegedBrokerApprovalEvidence) => candidate.method === 'trusted-local'
      && privilegedBrokerDigest(PrivilegedBrokerApprovalEvidenceSchema.parse(candidate)) === expectedDigest,
  });
}
