#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const configPath = process.env.MCP_PORTAL_CONFIG
  ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'mcp-portals', 'endpoints.json');

function fail(message) {
  process.stderr.write(`mcp-portal-profile: ${message}\n`);
  process.exit(1);
}

function loadConfig() {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    fail(`cannot read ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed?.schemaVersion !== 1 || !parsed.profiles || typeof parsed.profiles !== 'object') {
    fail('invalid portal descriptor');
  }
  return parsed;
}

function resolveSecret(name) {
  try {
    const value = execFileSync('get-secret', [name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
      timeout: 15_000,
    }).trim();
    if (!value) fail(`get-secret returned an empty value for ${name}`);
    return value;
  } catch (error) {
    fail(`unable to resolve ${name} with get-secret`);
  }
}

const [action = 'list', profileName, separator, ...command] = process.argv.slice(2);
const config = loadConfig();

if (action === 'list') {
  for (const [name, profile] of Object.entries(config.profiles)) {
    process.stdout.write(`${name}\t${profile.url}\t${profile.authentication}\n`);
  }
  process.exit(0);
}

const profile = config.profiles[profileName];
if (!profile || typeof profile.url !== 'string') fail(`unknown profile: ${profileName ?? ''}`);

if (action === 'url') {
  process.stdout.write(`${profile.url}\n`);
  process.exit(0);
}

if (action !== 'exec' || separator !== '--' || command.length === 0) {
  fail('usage: mcp-portal-profile {list|url <profile>|exec <profile> -- <command> [args...]}');
}

const childEnv = { ...process.env, MCP_PORTAL_PROFILE: profileName, MCP_PORTAL_URL: profile.url };
if (profile.authentication === 'service-token-per-workload') {
  const refs = profile.secretRefs;
  if (typeof refs?.clientId !== 'string' || typeof refs?.clientSecret !== 'string') {
    fail(`profile ${profileName} has invalid secret references`);
  }
  childEnv.MCP_PORTAL_CF_ACCESS_CLIENT_ID = resolveSecret(refs.clientId);
  childEnv.MCP_PORTAL_CF_ACCESS_CLIENT_SECRET = resolveSecret(refs.clientSecret);
}

const child = spawn(command[0], command.slice(1), { env: childEnv, stdio: 'inherit' });
child.once('error', (error) => fail(`cannot start ${command[0]}: ${error.message}`));
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
