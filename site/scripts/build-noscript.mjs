#!/usr/bin/env node
import { spawnSync } from 'child_process';
import { copyFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(scriptDir, '..');
const require = createRequire(join(siteRoot, 'package.json'));
const stencilBin = require.resolve('@stencil/core/bin/stencil');

const extraArgs = process.argv.slice(2);
const result = spawnSync(
  process.execPath,
  [stencilBin, 'build', '--prerender', '--ci', ...extraArgs],
  {
    cwd: siteRoot,
    env: {
      ...process.env,
      SITE_NOSCRIPT: '1',
    },
    stdio: 'inherit',
  },
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const builtCss = join(siteRoot, 'www', 'build', 'site.css');
const targetCss = join(siteRoot, 'src', 'site-noscript.css');

if (!existsSync(builtCss)) {
  console.error(`Expected Stencil CSS output at ${builtCss}, but file was not generated.`);
  process.exit(1);
}

copyFileSync(builtCss, targetCss);
