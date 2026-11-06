import { fstatSync } from 'node:fs';
import { z } from 'zod';

const InheritedSecretFdOptionsSchema = z.strictObject({
  fd: z.number().int().min(3).max(255),
  purpose: z.enum(['sudo-password']),
  maxBytes: z.number().int().min(1).max(4_096),
});

export type InheritedSecretFdOptions = z.input<typeof InheritedSecretFdOptionsSchema>;

/**
 * A one-shot capability for forwarding an already-open anonymous IPC
 * descriptor. The broker deliberately never reads the descriptor: secret
 * bytes stay outside engine memory and therefore outside argv, environment,
 * plans, journals, renderer events, and errors.
 *
 * The receiving operation must enforce `maxBytes`, consume at most one value,
 * close its descriptor on every exit path, and avoid echoing input. This
 * admission object does not make run-wide cleanup authoritative; callers must
 * not wire a credential flow until interruption and stale-run reconciliation
 * are also implemented.
 */
export interface InheritedSecretFdBroker {
  readonly purpose: 'sudo-password';
  readonly maxBytes: number;
  claimSourceFd(): number;
}

export function createInheritedSecretFdBroker(input: InheritedSecretFdOptions): InheritedSecretFdBroker {
  if (process.platform === 'win32') throw new Error('inherited secret descriptors are unsupported on win32');
  const options = InheritedSecretFdOptionsSchema.parse(input);
  const metadata = fstatSync(options.fd);
  if (!metadata.isFIFO() && !metadata.isSocket()) {
    throw new Error('inherited secret descriptor must be an anonymous pipe or socket');
  }

  let claimed = false;
  const identity = { dev: metadata.dev, ino: metadata.ino, mode: metadata.mode };
  return Object.freeze({
    purpose: options.purpose,
    maxBytes: options.maxBytes,
    claimSourceFd(): number {
      if (claimed) throw new Error('inherited secret descriptor capability was already claimed');
      const current = fstatSync(options.fd);
      if (current.dev !== identity.dev || current.ino !== identity.ino || current.mode !== identity.mode) {
        throw new Error('inherited secret descriptor identity changed before claim');
      }
      claimed = true;
      return options.fd;
    },
  });
}
