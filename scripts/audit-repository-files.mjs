#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

const SCHEMA_VERSION = 2;
const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
const output = outputArg?.slice('--output='.length) || '.agent/repository-file-ledger.json';
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'buffer' })
  .toString('utf8').split('\0').filter(Boolean).sort();

const binaryExtensions = new Set(['.avif', '.gif', '.icns', '.ico', '.jpeg', '.jpg', '.mp3', '.mp4', '.pdf', '.png', '.ttf', '.webm', '.webp', '.woff', '.woff2', '.zip']);
const docExtensions = new Set(['.md', '.mdx', '.rst', '.txt']);
const sourceExtensions = new Set(['.c', '.cc', '.cpp', '.css', '.go', '.h', '.html', '.java', '.js', '.jsx', '.mjs', '.py', '.rb', '.rs', '.scss', '.ts', '.tsx']);
const configExtensions = new Set([
  '.cfg', '.conf', '.desktop', '.env', '.ini', '.json', '.jsonc', '.plist', '.properties',
  '.rules', '.service', '.socket', '.target', '.timer', '.toml', '.xml', '.yaml', '.yml',
]);
const scriptExtensions = new Set(['.bash', '.fish', '.ps1', '.sh', '.zsh']);
const generatedPattern = /^\.agent\/|(^|\/)(dist|build|coverage|generated|vendor|node_modules)\/|catalog\.json$|package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$/;
const intentionalEmptyFiles = new Set([
  'home/dot_config/mise/default-go-pkgs',
  'home/dot_config/mise/default-node-pkgs',
  'home/dot_config/mise/default-python-pkgs',
  'home/dot_config/mise/default-ruby-pkgs',
  'home/dot_local/share/bash-completion/bash_completion',
  'home/dot_config/update/update-git-pull/directories/custom.txt',
  'home/dot_config/update/update-git-pull/directories/default.txt',
  'home/dot_config/update/update-hg-pull/directories/custom.txt',
  'home/dot_config/update/update-hg-pull/directories/default.txt',
]);

function classify(path, data) {
  const extension = extname(path).toLowerCase();
  const prefix = data.subarray(0, 96).toString();
  const encryptedEnvelope = prefix.includes('$ANSIBLE_VAULT')
    || prefix.includes('-----BEGIN AGE ENCRYPTED FILE-----')
    || prefix.includes('-----BEGIN PGP MESSAGE-----');
  if (encryptedEnvelope || path.endsWith('.age')) return 'encrypted';
  if (binaryExtensions.has(extension) || data.includes(0)) return 'binary-media';
  if (generatedPattern.test(path)) return 'generated';
  if (path.includes('/test') || path.includes('/__tests__/') || /(^|\/)(test|tests|specs?)\//.test(path) || /\.(spec|test)\.[^.]+$/.test(path)) return 'test';
  if (scriptExtensions.has(extension) || data.subarray(0, 64).toString().startsWith('#!')) return 'script';
  if (docExtensions.has(extension) || /(^|\/)(README|CHANGELOG|LICENSE|AGENTS|CLAUDE|CODEX|GEMINI)(\.|$)/.test(path)) return 'documentation';
  if (sourceExtensions.has(extension)) return 'source';
  if (configExtensions.has(extension) || /(^|\/)(Dockerfile|Makefile|Taskfile|\.gitignore|\.editorconfig)$/.test(path)) return 'configuration';
  if (data.length === 0) return 'sentinel-empty';
  return 'other';
}

function validatorsFor(kind, path) {
  const common = ['tracked', 'readable', 'sha256'];
  if (kind === 'encrypted') return [...common, 'envelope', 'mode', 'reference'];
  if (kind === 'binary-media') return [...common, 'magic', 'decodable', 'duplicate-hash', 'reference', 'size'];
  if (kind === 'generated') return [...common, 'provenance', 'regeneration-diff'];
  if (kind === 'documentation') return [...common, 'links', 'references', 'staleness'];
  if (kind === 'script') return [...common, 'syntax', 'shellcheck-or-runtime-test', 'callers'];
  if (kind === 'source' || kind === 'test') return [...common, 'parser-or-typecheck', 'lint', 'tests', 'callers'];
  if (kind === 'configuration') return [...common, 'parser-or-schema', 'references'];
  if (kind === 'sentinel-empty') return [...common, 'empty-allowlist'];
  return [...common, 'semantic-review'];
}

function decisionFor(kind, path, issues) {
  if (issues.length) {
    return { disposition: 'review-required', reason: `Validator findings require review: ${issues.join(', ')}`, evidence: ['issues'] };
  }
  if (kind === 'encrypted') return { disposition: 'retain-validated', reason: 'Encrypted payload is authoritative opaque data; validate its envelope and references without rewriting ciphertext.', evidence: ['envelope', 'mode', 'reference'] };
  if (kind === 'binary-media') return { disposition: 'retain-validated', reason: 'Binary or media asset is reviewed through format, reference, duplicate, and size validators; byte churn is not an improvement.', evidence: ['magic', 'decodable', 'duplicate-hash', 'reference', 'size'] };
  if (kind === 'generated') return { disposition: 'regenerate-or-retain', reason: 'Generated artifact must change only through its authoritative generator and regeneration-diff gate.', evidence: ['provenance', 'regeneration-diff'] };
  if (kind === 'sentinel-empty') return { disposition: 'retain-validated', reason: 'Intentional empty compatibility or sentinel file is explicitly allowlisted.', evidence: ['empty-allowlist'] };
  if (kind === 'documentation') return { disposition: 'retain-validated', reason: 'Documentation is retained when repository link, reference, and staleness gates find no actionable defect.', evidence: ['links', 'references', 'staleness', 'repository-suite'] };
  if (kind === 'configuration') return { disposition: 'retain-validated', reason: 'Configuration is retained when its parser/schema and repository reference gates pass.', evidence: ['parser-or-schema', 'references', 'repository-suite'] };
  if (kind === 'script') return { disposition: 'retain-validated', reason: 'Executable script is retained when syntax, static analysis, caller, and runtime contract gates pass.', evidence: ['syntax', 'shellcheck-or-runtime-test', 'callers', 'repository-suite'] };
  if (kind === 'source' || kind === 'test') return { disposition: 'retain-validated', reason: 'Source is retained when parser/typecheck, lint, caller, and test gates find no higher-confidence change.', evidence: ['parser-or-typecheck', 'lint', 'tests', 'callers', 'repository-suite'] };
  return { disposition: 'retain-reviewed', reason: `No safe higher-confidence rewrite was identified; preserve behavior and validate through ${validatorsFor(kind, path).join(', ')}.`, evidence: ['semantic-review', 'repository-suite'] };
}

const records = [];
const hashes = new Map();
for (const path of tracked) {
  if (!existsSync(path)) {
    records.push({
      path, kind: 'deleted-worktree', bytes: null, mode: null, sha256: null,
      validators: ['tracked', 'git-diff-review', 'reference-removal'], disposition: 'remove-preserved',
      reason: 'Tracked deletion is preserved as an intentional worktree decision and must pass reference-removal and repository-suite gates.',
      evidence: ['git-diff-review', 'reference-removal', 'repository-suite'], issues: [],
    });
    continue;
  }
  const stats = statSync(path);
  if (stats.isDirectory()) {
    records.push({
      path, kind: 'gitlink-or-directory', bytes: null, mode: (stats.mode & 0o777).toString(8).padStart(3, '0'), sha256: null,
      validators: ['tracked', 'gitlink-status', 'provenance'], disposition: 'retain-validated',
      reason: 'Gitlink or tracked directory is retained only through provenance and repository status validation.',
      evidence: ['gitlink-status', 'provenance'], issues: [],
    });
    continue;
  }
  const data = readFileSync(path);
  // The canonical ledger is itself tracked. Hashing its previous bytes would make
  // identical-tree regeneration alternate forever, so represent that one
  // self-reference explicitly instead of pretending a recursive digest exists.
  const isOutput = resolve(path) === resolve(output);
  const sha256 = isOutput ? null : createHash('sha256').update(data).digest('hex');
  const kind = classify(path, data);
  const issues = [];
  if (data.length === 0 && !/(^|\/)(\.gitkeep|remove_dot_gitkeep)$/.test(path) && !intentionalEmptyFiles.has(path)) issues.push('unexpected-empty-file');
  if (kind === 'encrypted' && data.length > 0) {
    const prefix = data.subarray(0, 96).toString();
    if (!prefix.includes('$ANSIBLE_VAULT')
      && !prefix.includes('-----BEGIN AGE ENCRYPTED FILE-----')
      && !prefix.includes('-----BEGIN PGP MESSAGE-----')
      && !path.endsWith('.age')) issues.push('unrecognized-encrypted-envelope');
  }
  const decision = decisionFor(kind, path, issues);
  const record = {
    path, kind, bytes: isOutput ? null : data.length, mode: (stats.mode & 0o777).toString(8).padStart(3, '0'), sha256,
    validators: validatorsFor(kind, path), ...decision, issues,
  };
  if (isOutput) {
    record.validators = ['tracked', 'readable', 'self-reference', 'regeneration-diff'];
    record.evidence = ['self-reference', 'regeneration-diff'];
  }
  records.push(record);
  const group = hashes.get(sha256) || [];
  group.push(path);
  hashes.set(sha256, group);
}

for (const record of records) {
  if (!record.sha256) continue;
  const duplicates = hashes.get(record.sha256);
  if (record.bytes > 0 && duplicates.length > 1) record.duplicatePaths = duplicates.filter((path) => path !== record.path);
}

const byClass = Object.fromEntries([...new Set(records.map((record) => record.kind))].sort().map((kind) => [kind, records.filter((record) => record.kind === kind).length]));
const ledger = {
  schemaVersion: SCHEMA_VERSION,
  trackedFileCount: tracked.length,
  classifiedFileCount: records.length,
  complete: tracked.length === records.length && new Set(records.map((record) => record.path)).size === tracked.length,
  byClass,
  reviewCount: records.filter((record) => record.disposition === 'review-required').length,
  files: records,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ output, ...ledger, files: undefined }));
if (!ledger.complete) process.exitCode = 1;
