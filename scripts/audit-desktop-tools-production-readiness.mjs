#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

const REQUIRED_VARIABLES = Object.freeze([
  'DESKTOP_TOOLS_RELEASE_SIGNER_ID',
  'INFISICAL_DESKTOP_TOOLS_RELEASE_ACTIVATOR_ID',
  'INFISICAL_DESKTOP_TOOLS_RELEASE_MONITOR_ID',
  'INFISICAL_DESKTOP_TOOLS_RELEASE_PUBLISHER_ID',
  'INFISICAL_DESKTOP_TOOLS_RELEASE_SIGNER_ID',
  'INFISICAL_PROJECT_SLUG'
]);
const REQUIRED_ENVIRONMENTS = Object.freeze([
  'desktop-tools-release-activate',
  'desktop-tools-release-monitor',
  'desktop-tools-release-publish',
  'desktop-tools-release-sign'
]);
const ADDRESS = /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]+$/i;

function command(file, args) {
  try {
    return { ok: true, output: execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 }).trim() };
  } catch (error) {
    return { ok: false, output: '', error: `${file} exited ${error.status ?? 'unknown'}` };
  }
}

function publicAddresses(hostname) {
  const values = [];
  for (const type of ['A', 'AAAA']) {
    const result = command('dig', ['+short', '+time=3', '+tries=1', '@1.1.1.1', hostname, type]);
    if (result.ok) values.push(...result.output.split(/\s+/).filter(value => ADDRESS.test(value)));
  }
  return [...new Set(values)].sort();
}

async function httpProbe(url) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'desktop-tools-readiness/1' } });
    const body = (await response.text()).slice(0, 4096);
    return { reachable: true, status: response.status, contentType: response.headers.get('content-type') ?? '', shellLauncher: body.startsWith('#!/usr/bin/env bash') || body.startsWith('#!/bin/bash') };
  } catch {
    return { reachable: false, status: 0, contentType: '', shellLauncher: false };
  }
}

async function collect(root) {
  const trust = JSON.parse(readFileSync(`${root}/packages/control-plane/src/release-trust.json`, 'utf8'));
  const platformMatrix = JSON.parse(readFileSync(`${root}/scripts/platform-support-matrix.json`, 'utf8'));
  const platformValidation = command(process.execPath, [`${root}/scripts/validate-platform-support-matrix.mjs`, `${root}/scripts/platform-support-matrix.json`]);
  const variables = command('gh', ['variable', 'list', '--repo', 'heymegabyte/install.doctor', '--json', 'name,value']);
  const environments = command('gh', ['api', 'repos/heymegabyte/install.doctor/environments']);
  const variableRows = variables.ok ? JSON.parse(variables.output || '[]') : [];
  const environmentRows = environments.ok ? JSON.parse(environments.output || '{}').environments ?? [] : [];
  const environmentPolicies = Object.fromEntries(environmentRows.map(environment => {
    const rules = Array.isArray(environment.protection_rules) ? environment.protection_rules : [];
    const reviewers = rules.find(rule => rule.type === 'required_reviewers');
    return [environment.name, {
      branchPolicy: rules.some(rule => rule.type === 'branch_policy'),
      reviewerCount: Array.isArray(reviewers?.reviewers) ? reviewers.reviewers.length : 0,
      preventSelfReview: reviewers?.prevent_self_review === true
    }];
  }));
  return {
    schemaVersion: 1,
    signerIds: Object.keys(trust.products?.['desktop-tools']?.signers ?? {}).sort(),
    verifiedPlatformIds: platformMatrix.cells?.filter(cell => cell.status === 'verified').map(cell => cell.id).sort() ?? [],
    configuredSignerId: variableRows.find(value => value.name === 'DESKTOP_TOOLS_RELEASE_SIGNER_ID')?.value ?? '',
    variableNames: variableRows.map(value => value.name).sort(),
    environmentNames: environmentRows.map(value => value.name).sort(),
    environmentPolicies,
    commandErrors: [platformValidation, variables, environments].flatMap(result => result.ok ? [] : [result.error]),
    dns: { apex: publicAddresses('desktop.tools'), profile: publicAddresses('example.desktop.tools') },
    http: {
      profile: await httpProbe('https://example.desktop.tools/'),
      unknown: await httpProbe('https://unknown.desktop.tools/')
    }
  };
}

export function evaluateProductionReadiness(evidence) {
  const checks = [];
  const check = (id, passed, detail) => checks.push({ id, status: passed ? 'PASS' : 'BLOCKED', detail });
  const signers = Array.isArray(evidence.signerIds) ? evidence.signerIds : [];
  const variables = new Set(Array.isArray(evidence.variableNames) ? evidence.variableNames : []);
  const environments = new Set(Array.isArray(evidence.environmentNames) ? evidence.environmentNames : []);
  const verifiedPlatforms = Array.isArray(evidence.verifiedPlatformIds) ? evidence.verifiedPlatformIds : [];
  check('verified-platform', verifiedPlatforms.length > 0, verifiedPlatforms.length ? `verified full-lifecycle tuples: ${verifiedPlatforms.join(', ')}` : 'no platform has a fresh verified full-lifecycle receipt');
  check('trusted-signer', signers.length > 0 && signers.every(id => /^desktop-[a-z0-9._-]+$/.test(id)), signers.length ? `${signers.length} canonical signer(s)` : 'no Desktop Tools signer is trusted');
  const missingVariables = REQUIRED_VARIABLES.filter(name => !variables.has(name));
  check('github-variables', missingVariables.length === 0, missingVariables.length ? `missing: ${missingVariables.join(', ')}` : 'all nonsecret variable names configured');
  const configuredSignerId = typeof evidence.configuredSignerId === 'string' ? evidence.configuredSignerId : '';
  check('signer-variable-binding', configuredSignerId.length > 0 && signers.includes(configuredSignerId), configuredSignerId ? `configured signer ${configuredSignerId} must exist in versioned trust` : 'DESKTOP_TOOLS_RELEASE_SIGNER_ID has no value');
  const missingEnvironments = REQUIRED_ENVIRONMENTS.filter(name => !environments.has(name));
  check('protected-environments', missingEnvironments.length === 0, missingEnvironments.length ? `missing: ${missingEnvironments.join(', ')}` : 'all release environments configured');
  const policies = evidence.environmentPolicies && typeof evidence.environmentPolicies === 'object' ? evidence.environmentPolicies : {};
  const sign = policies['desktop-tools-release-sign'] ?? {};
  const activate = policies['desktop-tools-release-activate'] ?? {};
  const publish = policies['desktop-tools-release-publish'] ?? {};
  const monitor = policies['desktop-tools-release-monitor'] ?? {};
  const protectedPolicy = sign.branchPolicy === true && sign.reviewerCount > 0 && sign.preventSelfReview === true
    && activate.branchPolicy === true && activate.reviewerCount > 0 && activate.preventSelfReview === true
    && publish.branchPolicy === true
    && monitor.branchPolicy === true && monitor.reviewerCount === 0;
  check('environment-protections', protectedPolicy, protectedPolicy ? 'sign and activation require independent review; publish is branch-bound; monitor remains nonblocking' : 'release environment protections do not match the required authority split');
  check('dns-apex', evidence.dns?.apex?.length > 0, evidence.dns?.apex?.length ? 'desktop.tools resolves publicly' : 'desktop.tools has no public address');
  check('dns-profile', evidence.dns?.profile?.length > 0, evidence.dns?.profile?.length ? 'example.desktop.tools resolves publicly' : 'example.desktop.tools has no public address');
  const profile = evidence.http?.profile ?? {};
  const shellContentType = typeof profile.contentType === 'string' && profile.contentType.toLowerCase().startsWith('text/x-shellscript');
  check('profile-launcher', profile.reachable === true && profile.status === 200 && profile.shellLauncher === true && shellContentType, `reachable=${profile.reachable === true} status=${profile.status ?? 0} shell=${profile.shellLauncher === true} contentType=${profile.contentType ?? ''}`);
  const unknown = evidence.http?.unknown ?? {};
  check('unknown-profile-fail-closed', unknown.reachable === true && [404, 410].includes(unknown.status) && unknown.shellLauncher === false, `reachable=${unknown.reachable === true} status=${unknown.status ?? 0} shell=${unknown.shellLauncher === true}`);
  check('evidence-collection', Array.isArray(evidence.commandErrors) && evidence.commandErrors.length === 0, evidence.commandErrors?.length ? evidence.commandErrors.join('; ') : 'required read-only commands succeeded');
  return { schemaVersion: 1, ready: checks.every(item => item.status === 'PASS'), checks };
}

const args = process.argv.slice(2);
const evidenceIndex = args.indexOf('--evidence');
const evidence = evidenceIndex >= 0
  ? JSON.parse(readFileSync(args[evidenceIndex + 1], 'utf8'))
  : await collect(new URL('..', import.meta.url).pathname.replace(/\/$/, ''));
const report = evaluateProductionReadiness(evidence);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ready) process.exitCode = 2;
