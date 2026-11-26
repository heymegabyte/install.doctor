import { readFile, writeFile } from 'node:fs/promises';
import { SoftwareCatalogEntrySchema } from '../packages/aid-core/dist/software-catalog.js';

const [destination] = process.argv.slice(2);
if (!destination) throw new Error('Expected the bootstrap acceptance catalog destination');

const source = new URL('../packages/control-plane/src/catalog.json', import.meta.url);
const catalog = JSON.parse(await readFile(source, 'utf8'));
for (const entry of catalog) {
  if (entry.name === 'mise' || entry.name === 'rclone') {
    entry.preload = false;
    entry.load = { delivery: 'lazy', policy: 'lazy', rationale: 'default-lazy' };
    entry.deliveryMode = entry.load.delivery;
    entry.loadPolicy = entry.load.policy;
    entry.loadRationale = entry.load.rationale;
    delete entry.preloadReason;
  }
  SoftwareCatalogEntrySchema.parse(entry);
}
await writeFile(destination, JSON.stringify(catalog) + '\n', { flag: 'wx' });
