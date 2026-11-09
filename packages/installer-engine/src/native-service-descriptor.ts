import { z } from 'zod';

/** Exact first native service authority shared by planning, release verification, and the root broker. */
export const PrivilegedBrokerServiceDescriptorSchema = z.strictObject({
  kind: z.literal('native-service'), manager: z.literal('systemd'),
  serviceKey: z.literal('alloy'), unit: z.literal('alloy.service'),
  desiredState: z.literal('enabled-and-started'),
});

export type PrivilegedBrokerServiceDescriptor = z.infer<typeof PrivilegedBrokerServiceDescriptorSchema>;
