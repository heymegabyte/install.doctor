import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const root = new URL('../', import.meta.url);
const manifest = z.object({
  name: z.string().min(1),
  exports: z.record(z.string(), z.string().startsWith('./dist/').endsWith('.js')),
}).parse(JSON.parse(readFileSync(new URL('package.json', root), 'utf8')));
const packReport = z.tuple([z.object({
  files: z.array(z.object({ path: z.string().min(1) })),
})]);

test('the npm archive contains runtime modules and declarations for every public export', async () => {
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, 'Run the package suite with npm test');
  const [pack] = packReport.parse(JSON.parse(execFileSync(process.execPath, [
    npmCli, 'pack', '--dry-run', '--ignore-scripts', '--json',
  ], { cwd: fileURLToPath(root), encoding: 'utf8' })));
  const paths = new Set(pack.files.map(({ path }) => path));

  for (const [subpath, entry] of Object.entries(manifest.exports)) {
    const runtimePath = entry.slice(2);
    assert.ok(paths.has(runtimePath), `Missing runtime module for ${subpath}: ${runtimePath}`);
    const declarationPath = runtimePath.replace(/\.js$/, '.d.ts');
    assert.ok(paths.has(declarationPath), `Missing declarations for ${subpath}: ${declarationPath}`);
    const specifier = subpath === '.' ? manifest.name : manifest.name + subpath.slice(1);
    assert.ok(Object.keys(await import(specifier)).length > 0, `Empty public module: ${specifier}`);
  }
});
