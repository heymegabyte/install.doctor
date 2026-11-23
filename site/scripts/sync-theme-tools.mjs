import { writeFile } from 'node:fs/promises';
import { DEFAULT_THEME_CSS } from '@theme-tools/themes/css';

const banner = '/* Generated from @theme-tools/themes. Do not edit directly. */\n';
await writeFile(
  new URL('../src/global/_theme-tools.scss', import.meta.url),
  `${banner}${DEFAULT_THEME_CSS.trim()}\n`,
);
