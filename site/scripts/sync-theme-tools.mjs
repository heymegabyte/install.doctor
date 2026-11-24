import { readFile, writeFile } from 'node:fs/promises';
import { DEFAULT_THEME_CSS } from '@theme-tools/themes/css';

const interactionAdapters = await readFile(
  new URL('../node_modules/@theme-tools/themes/src/interaction-adapters.css', import.meta.url),
  'utf8',
);

const banner = '/* Generated from @theme-tools/themes. Do not edit directly. */\n';
await writeFile(
  new URL('../src/global/_theme-tools.scss', import.meta.url),
  `${banner}${DEFAULT_THEME_CSS.trim()}\n${interactionAdapters.trim()}\n`,
);
