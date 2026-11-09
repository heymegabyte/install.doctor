import { dirname, isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { PrivilegedBrokerGrantSchema } from './privileged-broker-protocol.js';
import { PrivilegedBrokerExecutionAuthoritySchema } from './privileged-broker-authority.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const runtimePath = z.string().min(1).max(4096).refine(value => isAbsolute(value) && resolve(value) === value
  && value.startsWith('/run/desktop-tools/authority/'), 'broker runtime paths must be canonical and inside the root authority directory');
const socketPath = z.string().min(1).max(4096).refine(value => isAbsolute(value) && resolve(value) === value
  && /^\/run\/desktop-tools\/broker\/[a-z0-9][a-z0-9._-]{0,127}\/broker\.sock$/.test(value),
'broker socket must be the exact per-run socket path');

export const PrivilegedBrokerControllerInputSchema = z.strictObject({
  schemaVersion: z.literal(1),
  grant: PrivilegedBrokerGrantSchema,
  authority: PrivilegedBrokerExecutionAuthoritySchema,
  helperPath: runtimePath,
  runtimePath,
  workerPath: runtimePath,
  socketPath,
  socketGid: z.number().int().nonnegative(),
  requestLimit: z.number().int().min(1).max(256),
  operationTimeoutMs: z.number().int().min(1_000).max(30 * 60 * 1_000),
  helperDigest: digest,
  runtimeDigest: digest,
  workerDigest: digest,
}).superRefine((value, context) => {
  if (value.helperDigest !== value.grant.brokerExecutableDigest
    || value.runtimeDigest !== value.grant.runtimeDigest || value.workerDigest !== value.grant.workerDigest) {
    context.addIssue({ code: 'custom', message: 'controller executable authority differs from the exact grant' });
  }
  if (dirname(value.socketPath).split('/').at(-1) !== value.grant.runId) {
    context.addIssue({ code: 'custom', message: 'controller socket path differs from the exact run' });
  }
});

export type PrivilegedBrokerControllerInput = z.infer<typeof PrivilegedBrokerControllerInputSchema>;
