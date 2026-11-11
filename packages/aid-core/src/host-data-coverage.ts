/** Read-only host capability inventory and authoritative-data recovery coverage contracts. */
import { z } from 'zod';

const identifier = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,95}$/);
const boundedText = z.string().min(1).max(512).refine(value => !/[\r\n\0]/.test(value));
const observedAt = z.string().datetime({ offset: true });
const dataKinds = ['dataset', 'file', 'database', 'vm', 'container', 'configuration', 'key'] as const;
const protectionLayers = ['snapshot', 'replication', 'independent-backup', 'verification', 'restore'] as const;

const explicitCapability = z.object({
  id: identifier,
  state: z.enum(['supported', 'inapplicable', 'unknown']),
  reason: boundedText,
}).strict();

const hostInventory = z.object({
  id: identifier,
  observedAt,
  evidenceState: z.enum(['observed', 'redacted-observed', 'unverified']),
  os: z.object({ family: z.enum(['linux', 'darwin', 'windows', 'other']), version: boundedText, architecture: identifier }).strict(),
  hardware: z.object({ deviceClasses: z.array(identifier).max(128), notes: boundedText }).strict(),
  filesystems: z.array(identifier).max(128),
  pools: z.array(z.object({ id: identifier, technology: identifier, health: z.enum(['healthy', 'degraded', 'faulted', 'unknown']), encryption: z.enum(['encrypted', 'unencrypted', 'mixed', 'unknown']) }).strict()).max(128),
  encryption: z.array(z.object({ scope: boundedText, state: z.enum(['encrypted', 'unencrypted', 'mixed', 'unknown']), reason: boundedText }).strict()).max(128),
  virtualization: z.object({ role: z.enum(['none', 'host', 'guest', 'hybrid', 'unknown']), technologies: z.array(identifier).max(64) }).strict(),
  services: z.array(identifier).max(2048),
  protectionTools: z.array(identifier).max(256),
  capabilities: z.array(explicitCapability).min(1).max(512),
}).strict();

const layerDisposition = z.object({
  layer: z.enum(protectionLayers),
  state: z.enum(['protected', 'inapplicable', 'unprotected']),
  method: boundedText.optional(),
  reason: boundedText,
}).strict().superRefine((entry, context) => {
  if ((entry.state === 'protected') !== (entry.method !== undefined)) {
    context.addIssue({ code: 'custom', message: 'Only protected layers require an exact method' });
  }
});

const sourceCoverage = z.object({
  id: identifier,
  kind: z.enum(dataKinds),
  locator: boundedText,
  authoritative: z.literal(true),
  layers: z.array(layerDisposition).length(protectionLayers.length),
}).strict().superRefine((source, context) => {
  const layers = source.layers.map(entry => entry.layer);
  if (new Set(layers).size !== layers.length || !protectionLayers.every(layer => layers.includes(layer))) {
    context.addIssue({ code: 'custom', message: 'Every protection layer requires exactly one disposition' });
  }
});

const hostCoverage = z.object({
  hostId: identifier,
  inventoryObservedAt: observedAt,
  sources: z.array(sourceCoverage).max(10_000),
}).strict();

const estateSchema = z.object({
  schemaVersion: z.literal(1),
  inventories: z.array(hostInventory).min(1).max(10_000),
  coverage: z.array(hostCoverage).min(1).max(10_000),
}).strict().superRefine((estate, context) => {
  const hostIds = estate.inventories.map(host => host.id);
  const coverageIds = estate.coverage.map(host => host.hostId);
  if (new Set(hostIds).size !== hostIds.length || new Set(coverageIds).size !== coverageIds.length) context.addIssue({ code: 'custom', message: 'Host inventory and coverage ids must be unique' });
  if (hostIds.length !== coverageIds.length || !hostIds.every(id => coverageIds.includes(id))) context.addIssue({ code: 'custom', message: 'Every inventoried host requires exactly one coverage map' });
  for (const inventory of estate.inventories) {
    const map = estate.coverage.find(entry => entry.hostId === inventory.id);
    if (map?.inventoryObservedAt !== inventory.observedAt) context.addIssue({ code: 'custom', message: `Coverage for ${inventory.id} is not bound to its inventory observation` });
    const capabilityIds = inventory.capabilities.map(entry => entry.id);
    if (new Set(capabilityIds).size !== capabilityIds.length) context.addIssue({ code: 'custom', message: `Capabilities for ${inventory.id} must be unique` });
    for (const values of [inventory.hardware.deviceClasses, inventory.filesystems, inventory.services, inventory.protectionTools]) {
      if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', message: `Host ${inventory.id} inventory arrays must be unique` });
    }
  }
  for (const map of estate.coverage) {
    const ids = map.sources.map(source => source.id);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', message: `Coverage source ids for ${map.hostId} must be unique` });
  }
});

const discoveredSource = z.object({
  id: identifier,
  kind: z.enum(dataKinds),
  locator: boundedText,
  authoritative: z.boolean(),
}).strict();

export type HostDataCoverageEstate = z.infer<typeof estateSchema>;
export type HostCoverageHealth = { hostId: string; healthy: boolean; gaps: string[] };

export function validateHostDataCoverageEstate(input: unknown): HostDataCoverageEstate {
  return estateSchema.parse(input);
}

/** Compare read-only discovery with the reviewed map. New authoritative data always fails health. */
export function assessHostCoverage(input: unknown, hostId: string, discoveryInput: unknown): HostCoverageHealth {
  const estate = validateHostDataCoverageEstate(input);
  const discovery = z.array(discoveredSource).max(10_000).parse(discoveryInput);
  if (new Set(discovery.map(source => source.id)).size !== discovery.length) throw new Error('Discovered source ids must be unique');
  const map = estate.coverage.find(entry => entry.hostId === hostId);
  if (!map) throw new Error(`Unknown host ${hostId}`);
  const gaps: string[] = [];
  const discoveredAuthoritative = discovery.filter(source => source.authoritative);
  for (const source of discoveredAuthoritative) {
    const declared = map.sources.find(entry => entry.id === source.id);
    if (!declared) { gaps.push(`${source.id}: newly discovered authoritative source has no coverage map`); continue; }
    if (declared.kind !== source.kind || declared.locator !== source.locator) { gaps.push(`${source.id}: discovery does not match reviewed identity`); continue; }
  }
  for (const source of map.sources) {
    if (!discoveredAuthoritative.some(entry => entry.id === source.id)) gaps.push(`${source.id}: reviewed authoritative source was not discovered`);
    for (const layer of source.layers) if (layer.state === 'unprotected') gaps.push(`${source.id}:${layer.layer}: unprotected`);
    if (source.layers.find(layer => layer.layer === 'restore')?.state !== 'protected') gaps.push(`${source.id}: no usable restore method`);
  }
  return { hostId, healthy: gaps.length === 0, gaps };
}
