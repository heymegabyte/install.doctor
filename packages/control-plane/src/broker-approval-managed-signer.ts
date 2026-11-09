import { z } from 'zod';
import type { BrokerApprovalManagedSigner } from './broker-approval-signer.ts';

const identifier = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const SignerResponse = z.object({
  schemaVersion: z.literal(1),
  keyId: identifier,
  algorithm: z.literal('Ed25519'),
  signature: z.string().min(86).max(86).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

type Fetcher = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };

/**
 * Narrow service-binding adapter for a non-exportable signer. The Worker sends
 * only signing bytes and accepts only one exact key identity and Ed25519 result.
 */
export function createBrokerApprovalManagedSigner(input: {
  readonly keyId: string;
  readonly service: Fetcher;
  readonly timeoutMs?: number;
}): BrokerApprovalManagedSigner {
  const keyId = identifier.parse(input.keyId);
  const timeoutMs = input.timeoutMs ?? 2_500;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new Error('managed signer timeout is outside policy');
  }
  return Object.freeze({
    keyId,
    async sign(message: Uint8Array): Promise<Uint8Array> {
      if (!(message instanceof Uint8Array) || message.byteLength < 32 || message.byteLength > 131_072) {
        throw new Error('managed signer message is outside policy');
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await input.service.fetch('https://broker-approval-signer.internal/v1/sign', {
          method: 'POST', signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ schemaVersion: 1, keyId, algorithm: 'Ed25519',
            message: Buffer.from(message).toString('base64url') }),
        });
      } finally { clearTimeout(timer); }
      if (!response.ok) throw new Error('managed broker approval signer is unavailable');
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(declared) && declared > 2_048) throw new Error('managed signer response is oversized');
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > 2_048) throw new Error('managed signer response is oversized');
      const parsed = SignerResponse.parse(JSON.parse(text) as unknown);
      if (parsed.keyId !== keyId) throw new Error('managed signer returned the wrong key identity');
      const signature = Buffer.from(parsed.signature, 'base64url');
      if (signature.byteLength !== 64 || signature.toString('base64url') !== parsed.signature) {
        throw new Error('managed signer returned a noncanonical Ed25519 signature');
      }
      return new Uint8Array(signature);
    },
  });
}
