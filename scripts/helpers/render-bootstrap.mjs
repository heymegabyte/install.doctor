#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderBootstrap } from '../../packages/control-plane/src/bootstrap.ts';

const [configurationPath] = process.argv.slice(2);
if (!configurationPath) {
  process.stderr.write('usage: render-bootstrap.mjs CONFIGURATION.json\n');
  process.exit(64);
}

const configuration = JSON.parse(readFileSync(resolve(configurationPath), 'utf8'));
process.stdout.write(renderBootstrap(configuration));
