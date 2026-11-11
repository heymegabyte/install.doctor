/** Strict, read-only hardware/firmware inventory and simulated fault evidence. */
import { z } from 'zod';

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/);
const boundedText = z.string().min(1).max(512).refine(value => !/[\r\n\0]/.test(value));
const timestamp = z.string().datetime({ offset: true });
const signalValue = z.union([z.string().max(256), z.number().finite(), z.boolean(), z.null()]);

export const hardwareCategories = ['cpu', 'memory', 'disk', 'gpu', 'firmware', 'secure-boot', 'tpm', 'battery', 'thermal', 'ups'] as const;

const requiredSignals: Record<typeof hardwareCategories[number], readonly string[]> = {
  cpu: ['model', 'logical-cpus', 'health'],
  memory: ['total-bytes', 'ecc', 'health'],
  disk: ['identity-sha256', 'transport', 'capacity-bytes', 'smart-health', 'nvme-health'],
  gpu: ['model', 'firmware', 'health'],
  firmware: ['vendor', 'version', 'health'],
  'secure-boot': ['state'],
  tpm: ['state', 'version'],
  battery: ['health', 'charge-percent', 'cycle-count'],
  thermal: ['state', 'temperature-celsius'],
  ups: ['state', 'charge-percent', 'runtime-seconds'],
};

const deviceSchema = z.object({
  id: identifier,
  identity: z.object({ type: z.enum(['host-stable', 'serial-sha256', 'wwn-sha256', 'eui-sha256', 'nguid-sha256']), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  signals: z.array(z.object({ id: identifier, value: signalValue, unit: z.string().max(32).nullable(), state: z.enum(['ok', 'warning', 'critical', 'unknown', 'unsupported']) }).strict()).min(1).max(256),
}).strict();

const categorySchema = z.object({
  category: z.enum(hardwareCategories),
  applicability: z.enum(['present', 'absent', 'unknown']),
  reason: boundedText,
  devices: z.array(deviceSchema).max(1024),
}).strict().superRefine((section, context) => {
  if ((section.applicability === 'present') !== (section.devices.length > 0)) context.addIssue({ code: 'custom', message: 'Only present categories may contain devices, and present categories require one' });
  for (const device of section.devices) {
    const signals = device.signals.map(signal => signal.id);
    if (new Set(signals).size !== signals.length) context.addIssue({ code: 'custom', message: `Signals for ${device.id} must be unique` });
    for (const required of requiredSignals[section.category]) if (!signals.includes(required)) context.addIssue({ code: 'custom', message: `${device.id} is missing required ${section.category} signal ${required}` });
    const diskIdentity = device.signals.find(signal => signal.id === 'identity-sha256');
    if (section.category === 'disk' && (diskIdentity?.value !== device.identity.sha256 || diskIdentity.state === 'unsupported')) context.addIssue({ code: 'custom', message: `${device.id} disk identity signal must match its stable identity digest` });
  }
});

const inventorySchema = z.object({
  schemaVersion: z.literal(1),
  hostId: identifier,
  collectedAt: timestamp,
  collector: z.object({ id: identifier, version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/), readOnly: z.literal(true) }).strict(),
  categories: z.array(categorySchema).length(hardwareCategories.length),
}).strict().superRefine((inventory, context) => {
  const categories = inventory.categories.map(section => section.category);
  if (new Set(categories).size !== categories.length || !hardwareCategories.every(category => categories.includes(category))) context.addIssue({ code: 'custom', message: 'Every hardware and firmware category requires exactly one inventory section' });
  const devices = inventory.categories.flatMap(section => section.devices.map(device => device.id));
  if (new Set(devices).size !== devices.length) context.addIssue({ code: 'custom', message: 'Device ids must be unique across the host' });
});

const faultSignals = {
  cpu: ['machine-check', 'temperature-critical'], memory: ['ecc-errors', 'health'],
  disk: ['smart-health', 'nvme-health', 'media-errors', 'wear', 'temperature-critical'],
  gpu: ['health', 'temperature-critical'], firmware: ['health'], 'secure-boot': ['state'], tpm: ['state'],
  battery: ['health', 'charge-low', 'temperature-critical'], thermal: ['state', 'temperature-critical'],
  ups: ['state', 'charge-low', 'runtime-low'],
} as const;

const faultSchema = z.object({
  schemaVersion: z.literal(1),
  simulationId: identifier,
  simulated: z.literal(true),
  hostId: identifier,
  deviceId: identifier,
  signal: identifier,
  severity: z.enum(['warning', 'critical']),
  observedValue: signalValue,
  threshold: signalValue,
  occurredAt: timestamp,
}).strict();

export type HardwareInventory = z.infer<typeof inventorySchema>;
export type SimulatedHardwareFaultEvidence = {
  schemaVersion: 1; simulated: true; evidenceSha256: string; simulationId: string; hostId: string;
  deviceId: string; category: typeof hardwareCategories[number]; signal: string; severity: 'warning' | 'critical'; occurredAt: string;
};

export function validateHardwareInventory(input: unknown): HardwareInventory { return inventorySchema.parse(input); }

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Admit deterministic simulation evidence only for an exact known host/device and compatible signal. */
export async function classifySimulatedHardwareFault(inventoryInput: unknown, faultInput: unknown): Promise<SimulatedHardwareFaultEvidence> {
  const inventory = validateHardwareInventory(inventoryInput);
  const fault = faultSchema.parse(faultInput);
  if (fault.hostId !== inventory.hostId) throw new Error('Simulated fault host does not match inventory host');
  const section = inventory.categories.find(candidate => candidate.devices.some(device => device.id === fault.deviceId));
  if (!section) throw new Error('Simulated fault device is not present in the host inventory');
  if (!(faultSignals[section.category] as readonly string[]).includes(fault.signal)) throw new Error(`Signal ${fault.signal} is not valid for ${section.category} device ${fault.deviceId}`);
  const canonical = JSON.stringify([fault.schemaVersion, fault.simulationId, fault.hostId, fault.deviceId, section.category, fault.signal, fault.severity, fault.observedValue, fault.threshold, fault.occurredAt]);
  return {
    schemaVersion: 1, simulated: true, evidenceSha256: await sha256(canonical), simulationId: fault.simulationId,
    hostId: fault.hostId, deviceId: fault.deviceId, category: section.category, signal: fault.signal,
    severity: fault.severity, occurredAt: fault.occurredAt,
  };
}
