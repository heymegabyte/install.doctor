#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTransaction, loadPinnedProfiles, rollbackTransaction } from './mcp-host-manifest-consumer.mjs';

const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const fail = message => { throw new Error(`reconcile-mcp-clients: ${message}`); };
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const defaultMacosClients = () => [
  { kind: 'codex', path: `${homedir()}/.codex/config.toml` },
  { kind: 'claude-code', path: `${homedir()}/.claude.json` },
  { kind: 'claude-desktop', path: `${homedir()}/Library/Application Support/Claude/claude_desktop_config.json` },
  { kind: 'opencode', path: `${homedir()}/.config/opencode/opencode.jsonc` },
  { kind: 'cursor', path: `${homedir()}/.cursor/mcp.json` },
];

function stripJsonComments(source) {
  let output = '', string = false, escape = false, line = false, block = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index], next = source[index + 1];
    if (line) { if (char === '\n') { line = false; output += char; } else output += ' '; continue; }
    if (block) { if (char === '*' && next === '/') { output += '  '; block = false; index += 1; } else output += char === '\n' ? '\n' : ' '; continue; }
    if (!string && char === '/' && next === '/') { output += '  '; line = true; index += 1; continue; }
    if (!string && char === '/' && next === '*') { output += '  '; block = true; index += 1; continue; }
    output += char;
    if (string) {
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') string = false;
    } else if (char === '"') string = true;
  }
  if (string || block) fail('unterminated JSONC string or comment');
  return output;
}

function parseJsonc(source, label) {
  try { return JSON.parse(stripJsonComments(source)); } catch { fail(`${label} is not valid JSON/JSONC`); }
}

function matchingBrace(source, start) {
  let depth = 0, string = false, escape = false, line = false, block = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index], next = source[index + 1];
    if (line) { if (char === '\n') line = false; continue; }
    if (block) { if (char === '*' && next === '/') { block = false; index += 1; } continue; }
    if (!string && char === '/' && next === '/') { line = true; index += 1; continue; }
    if (!string && char === '/' && next === '*') { block = true; index += 1; continue; }
    if (string) {
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') string = false;
      continue;
    }
    if (char === '"') { string = true; continue; }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return index;
  }
  fail('could not locate closing object brace');
}

function propertyObjectStart(source, key) {
  const masked = stripJsonComments(source);
  const root = masked.indexOf('{');
  let depth = 0, string = false, escape = false, stringStart = -1;
  for (let index = root; index < masked.length; index += 1) {
    const char = masked[index];
    if (string) {
      if (escape) escape = false;
      else if (char === '\\') escape = true;
      else if (char === '"') {
        string = false;
        if (depth === 1) {
          let cursor = index + 1;
          while (/\s/.test(masked[cursor] ?? '')) cursor += 1;
          if (masked[cursor] === ':' && JSON.parse(source.slice(stringStart, index + 1)) === key) {
            cursor += 1;
            while (/\s/.test(masked[cursor] ?? '')) cursor += 1;
            if (masked[cursor] !== '{') fail(`${key} must be an object`);
            return cursor;
          }
        }
      }
      continue;
    }
    if (char === '"') { string = true; stringStart = index; continue; }
    if (char === '{' || char === '[') depth += 1;
    if (char === '}' || char === ']') depth -= 1;
  }
  fail(`could not locate top-level ${key} object`);
}

function insertJsonProperty(source, containerKey, name, entry) {
  const parsed = parseJsonc(source, 'client config');
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') fail('client config root must be an object');
  const container = parsed[containerKey];
  if (container !== undefined && (!container || Array.isArray(container) || typeof container !== 'object')) fail(`${containerKey} must be an object`);
  if (container?.[name]) {
    if (container[name].url !== entry.url || (entry.type && container[name].type !== entry.type)) fail(`managed MCP server collision for ${name}`);
    return { content: source, preservedNames: Object.keys(container).filter(value => value !== name), changed: false };
  }
  const property = `${JSON.stringify(name)}: ${JSON.stringify(entry, null, 2).replace(/\n/g, '\n    ')}`;
  if (container) {
    const start = propertyObjectStart(source, containerKey);
    const end = matchingBrace(source, start);
    const nonWhitespace = stripJsonComments(source.slice(start + 1, end)).trim();
    const insertion = `${nonWhitespace ? ',' : ''}\n    ${property}\n  `;
    return { content: `${source.slice(0, end)}${insertion}${source.slice(end)}`, preservedNames: Object.keys(container), changed: true };
  }
  const rootStart = source.indexOf('{');
  const rootEnd = matchingBrace(source, rootStart);
  const nonWhitespace = stripJsonComments(source.slice(rootStart + 1, rootEnd)).trim();
  const insertion = `${nonWhitespace ? ',' : ''}\n  ${JSON.stringify(containerKey)}: {\n    ${property}\n  }\n`;
  return { content: `${source.slice(0, rootEnd)}${insertion}${source.slice(rootEnd)}`, preservedNames: [], changed: true };
}

function renderToml(source, name, endpoint) {
  const names = [...source.matchAll(/^\[mcp_servers\.([^\]]+)\]\s*$/gm)].map(match => match[1]);
  if (names.includes(name)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const header = new RegExp(`^\\[mcp_servers\\.${escaped}\\]\\s*$`, 'm').exec(source);
    const contentStart = header.index + header[0].length;
    const nextHeader = /^\[/m.exec(source.slice(contentStart));
    const section = source.slice(contentStart, nextHeader ? contentStart + nextHeader.index : source.length);
    const url = section.match(/^url\s*=\s*"([^"]+)"\s*$/m)?.[1];
    if (url !== endpoint) fail(`managed MCP server collision for ${name}`);
    return { content: source, preservedNames: names.filter(value => value !== name), changed: false };
  }
  const separator = source.endsWith('\n') ? '\n' : '\n\n';
  return {
    content: `${source}${separator}# Managed by heymegabyte/mcp.megabyte.space\n[mcp_servers.${name}]\nurl = ${JSON.stringify(endpoint)}\n`,
    preservedNames: names,
    changed: true,
  };
}

export function selectProfile(loaded, callerClass) {
  if (!['human', 'automation'].includes(callerClass)) fail('caller class must be human or automation');
  const profile = loaded.profiles.find(value => value.id.endsWith(callerClass === 'human' ? '-human' : '-automation'));
  if (!profile) fail(`missing ${callerClass} profile`);
  return profile;
}

export function renderClient({ kind, source, profile }) {
  const name = profile.remote.managedName;
  const endpoint = profile.remote.endpoint;
  if (kind === 'codex') return renderToml(source, name, endpoint);
  if (kind === 'opencode') return insertJsonProperty(source, 'mcp', name, { type: 'remote', url: endpoint });
  if (['claude-code', 'claude-desktop', 'cursor'].includes(kind)) return insertJsonProperty(source, 'mcpServers', name, { url: endpoint });
  fail(`unsupported client kind ${kind}`);
}

export function buildClientPlan({ clients, loaded, callerClass }) {
  const profile = selectProfile(loaded, callerClass);
  const outputs = clients.map(({ kind, path }) => {
    const existed = existsSync(path);
    const source = existed ? readFileSync(path, 'utf8') : kind === 'codex' ? '' : '{}\n';
    const rendered = renderClient({ kind, source, profile });
    return { kind, path, content: rendered.content, existed, changed: rendered.changed, preservedNames: rendered.preservedNames.sort(), existingDigest: existed ? digest(source) : null, desiredDigest: digest(rendered.content) };
  });
  return { profile, outputs };
}

export function verifyInstalledPlan(plan) {
  for (const output of plan.outputs) {
    const installed = readFileSync(output.path, 'utf8');
    if (digest(installed) !== output.desiredDigest) fail(`installed digest mismatch for ${output.kind}`);
    const check = renderClient({ kind: output.kind, source: installed, profile: plan.profile });
    if (check.changed) fail(`installed config is not idempotent for ${output.kind}`);
    for (const name of output.preservedNames) if (!check.preservedNames.includes(name)) fail(`preserved entry missing for ${output.kind}: ${name}`);
  }
}

function parseArguments(args) {
  const options = {
    command: 'plan', hostClass: 'macos-workstation', callerClass: 'human', clients: [],
    pinPath: join(repositoryRoot, 'config/mcp-portals/canonical-pin.json'),
    sourceDirectory: join(repositoryRoot, 'config/mcp-portals/canonical-profiles'),
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (['plan', 'apply', 'rollback'].includes(value)) options.command = value;
    else if (value === '--host-class') options.hostClass = args[++index];
    else if (value === '--caller-class') options.callerClass = args[++index];
    else if (value === '--client') { const [kind, ...parts] = args[++index].split(':'); options.clients.push({ kind, path: resolve(parts.join(':')) }); }
    else if (value === '--receipt') options.receiptPath = resolve(args[++index]);
    else if (value === '--pin') options.pinPath = resolve(args[++index]);
    else if (value === '--source-directory') options.sourceDirectory = resolve(args[++index]);
    else fail(`unknown argument ${value}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.command === 'rollback') {
    if (!options.receiptPath) fail('rollback requires --receipt');
    process.stdout.write(json(rollbackTransaction(options.receiptPath)));
    return;
  }
  if (options.clients.length === 0) options.clients = defaultMacosClients();
  if (options.command === 'apply' && options.callerClass !== 'human') fail('automation apply requires runtime secret broker integration');
  const loaded = await loadPinnedProfiles(options);
  const plan = buildClientPlan({ clients: options.clients, loaded, callerClass: options.callerClass });
  const report = {
    schemaVersion: 1,
    operation: `${options.command}-mcp-client-reconciliation`,
    hostClass: options.hostClass,
    callerClass: options.callerClass,
    profileId: plan.profile.id,
    managedName: plan.profile.remote.managedName,
    revision: loaded.pin.revision,
    outputs: plan.outputs.map(({ content: _content, ...output }) => output),
  };
  if (options.command === 'plan') { process.stdout.write(json(report)); return; }
  if (!options.receiptPath) fail('apply requires --receipt');
  const receipt = applyTransaction({
    outputs: plan.outputs.map(({ path, content }) => ({ path, content })),
    receiptPath: options.receiptPath,
    operation: 'reconcile-mcp-clients',
  });
  try { verifyInstalledPlan(plan); } catch (error) { rollbackTransaction(options.receiptPath); throw error; }
  process.stdout.write(json({ ...report, status: 'installed', recordCount: receipt.records.length, receiptPath: options.receiptPath }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
