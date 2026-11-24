import { readFile, writeFile } from 'node:fs/promises';

const uiStyles = await readFile(
  new URL('../node_modules/@theme-tools/ui/dist/styles.css', import.meta.url),
  'utf8',
);

const banner = '/* Generated from @theme-tools/ui. Do not edit directly. */\n';
await writeFile(
  new URL('../src/global/_theme-tools.scss', import.meta.url),
  `${banner}${uiStyles.trim()}\n`,
);
