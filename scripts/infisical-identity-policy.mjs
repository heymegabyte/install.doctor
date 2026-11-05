#!/usr/bin/env node
/**
 * Validate and render value-free Infisical workload identity plans.
 * This tool is deliberately read-only: it never authenticates to or mutates Infisical.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ALLOWED_AUTH_MODES = new Set(['github-oidc', 'platform-oidc', 'universal-auth'])
const AUTH_MODE_PRIORITY = ['github-oidc', 'platform-oidc', 'universal-auth']
const REQUIRED_REVOCATION_STEPS = [
  'disable-identity',
  'revoke-issuing-credential',
  'wait-cache-window',
  'verify-denied',
]
const REQUIRED_ROTATION_STEPS = [
  'issue-new',
  'reload-consumer',
  'health-check',
  'revoke-old',
  'verify-old-denied',
]

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactString(value) {
  return typeof value === 'string' && value.length > 0 && value !== '*' && !value.includes('*')
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function sameSequence(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((item, index) => item === expected[index])
}

function validatePolicy(input) {
  const errors = []
  if (!isRecord(input) || input.schemaVersion !== 1 || !Array.isArray(input.workloads)) {
    return ['policy must be an object with schemaVersion 1 and a workloads array']
  }

  const ids = new Set()
  for (const [index, workload] of input.workloads.entries()) {
    const at = `workloads[${index}]`
    if (!isRecord(workload) || !exactString(workload.id) || !exactString(workload.runtime)) {
      errors.push(`${at} requires exact id and runtime values`)
      continue
    }
    if (ids.has(workload.id)) errors.push(`${at}.id must be unique`)
    ids.add(workload.id)

    const auth = workload.auth
    if (!Array.isArray(workload.availableAuthModes) || workload.availableAuthModes.length === 0
      || workload.availableAuthModes.some((mode) => !ALLOWED_AUTH_MODES.has(mode))) {
      errors.push(`${at}.availableAuthModes must inventory at least one supported mode`)
    }
    if (!isRecord(auth) || !ALLOWED_AUTH_MODES.has(auth.mode)) {
      errors.push(`${at}.auth.mode must be github-oidc, platform-oidc, or universal-auth`)
      continue
    }
    const preferredAuthMode = AUTH_MODE_PRIORITY.find((mode) => workload.availableAuthModes?.includes(mode))
    if (preferredAuthMode && auth.mode !== preferredAuthMode) {
      errors.push(`${at}.auth.mode is ${auth.mode}; preferred available auth mode is ${preferredAuthMode}`)
    }
    if (!exactString(auth.issuer)) errors.push(`${at}.auth.issuer must be exact`)
    if (!positiveInteger(auth.accessTokenTtlSeconds) || !positiveInteger(auth.accessTokenMaxTtlSeconds)) {
      errors.push(`${at}.auth requires finite positive access token TTL and max TTL`)
    } else if (auth.accessTokenTtlSeconds > auth.accessTokenMaxTtlSeconds) {
      errors.push(`${at}.auth accessTokenTtlSeconds cannot exceed accessTokenMaxTtlSeconds`)
    }
    if (!positiveInteger(auth.accessTokenMaxUses)) errors.push(`${at}.auth.accessTokenMaxUses must be finite and positive`)
    if (!exactString(auth.trustedIpRationale)) errors.push(`${at}.auth.trustedIpRationale is required even when no trusted CIDR is used`)
    if (auth.trustedCidrs !== undefined && (!Array.isArray(auth.trustedCidrs) || auth.trustedCidrs.some((cidr) => !exactString(cidr)))) {
      errors.push(`${at}.auth.trustedCidrs must contain exact CIDRs`)
    }

    if (workload.runtime === 'github-actions' && auth.mode !== 'github-oidc') {
      errors.push(`${at} GitHub Actions must use github-oidc`)
    }
    if (auth.mode === 'github-oidc') {
      const claims = auth.claims
      if (!isRecord(claims) || !exactString(claims.repository) || !exactString(claims.ref) || !exactString(claims.environment)) {
        errors.push(`${at}.auth requires exact repository/ref/environment claims`)
      }
    }
    if (auth.mode === 'universal-auth') {
      if (!exactString(workload.federationUnavailableReason)) {
        errors.push(`${at} Universal Auth requires federationUnavailableReason`)
      }
      if (!exactString(auth.clientSecretExpiresAt) || Number.isNaN(Date.parse(auth.clientSecretExpiresAt))) {
        errors.push(`${at}.auth Universal Auth requires a finite clientSecretExpiresAt`)
      }
      if (!positiveInteger(auth.clientSecretExpiryAlertDays)) {
        errors.push(`${at}.auth Universal Auth requires positive clientSecretExpiryAlertDays`)
      }
    }

    const authorization = workload.authorization
    if (!isRecord(authorization) || !exactString(authorization.project) || !exactString(authorization.environment) || !exactString(authorization.path)) {
      errors.push(`${at}.authorization requires an exact project, environment, and path`)
    } else if (!authorization.path.startsWith('/') || authorization.path.includes('..')) {
      errors.push(`${at}.authorization.path must be absolute and cannot traverse parents`)
    }
    if (!Array.isArray(authorization?.secretNames) || authorization.secretNames.length === 0 || authorization.secretNames.some((name) => !exactString(name))) {
      errors.push(`${at}.authorization.secretNames must be a non-empty exact allowlist`)
    }
    if (!Array.isArray(authorization?.inheritedGrants)) {
      errors.push(`${at}.authorization.inheritedGrants must be explicitly inventoried`)
    } else if (authorization.inheritedGrants.length > 0) {
      errors.push(`${at}.authorization inherited grants are additive and must be removed or explicitly isolated before enrollment`)
    }

    if (!Array.isArray(workload.platformBindings)) {
      errors.push(`${at}.platformBindings must be an array`)
    } else {
      for (const [bindingIndex, binding] of workload.platformBindings.entries()) {
        if (!isRecord(binding) || binding.authority !== 'infisical' || !exactString(binding.platform) || !exactString(binding.binding) || !exactString(binding.sourceRef) || !binding.sourceRef.startsWith('infisical://')) {
          errors.push(`${at}.platformBindings[${bindingIndex}] must use one exact infisical:// reference with Infisical as authority`)
        }
      }
    }

    const revocation = workload.revocation
    if (!isRecord(revocation) || !positiveInteger(revocation.tokenCacheWindowSeconds)) {
      errors.push(`${at}.revocation must acknowledge a finite positive token cache window`)
    }
    if (!sameSequence(revocation?.urgentProcedure, REQUIRED_REVOCATION_STEPS)) {
      errors.push(`${at}.revocation.urgentProcedure must disable identity, revoke the issuing credential, wait the cache window, then verify denial`)
    }

    const rotation = workload.rotation
    if (!isRecord(rotation) || !positiveInteger(rotation.overlapSeconds) || !exactString(rotation.healthCheck)) {
      errors.push(`${at}.rotation requires a finite overlap and bounded healthCheck`)
    }
    if (!sameSequence(rotation?.steps, REQUIRED_ROTATION_STEPS)) {
      errors.push(`${at}.rotation.steps must reload and health-check before revoke-old`)
    }
  }
  return errors
}

function policyPlan(policy) {
  const workloads = [...policy.workloads]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((workload) => ({
      id: workload.id,
      runtime: workload.runtime,
      authMode: workload.auth.mode,
      availableAuthModes: workload.availableAuthModes,
      issuer: workload.auth.issuer,
      selectionReason: workload.auth.mode === 'universal-auth'
        ? workload.federationUnavailableReason
        : 'federated identity available',
      claims: workload.auth.mode === 'github-oidc' ? {
        repository: workload.auth.claims.repository,
        ref: workload.auth.claims.ref,
        environment: workload.auth.claims.environment,
      } : null,
      tokenPolicy: {
        ttlSeconds: workload.auth.accessTokenTtlSeconds,
        maxTtlSeconds: workload.auth.accessTokenMaxTtlSeconds,
        maxUses: workload.auth.accessTokenMaxUses,
        trustedCidrs: workload.auth.trustedCidrs ?? [],
        trustedIpRationale: workload.auth.trustedIpRationale,
      },
      clientSecretExpiresAt: workload.auth.clientSecretExpiresAt ?? null,
      clientSecretExpiryAlertDays: workload.auth.clientSecretExpiryAlertDays ?? null,
      authorization: {
        project: workload.authorization.project,
        environment: workload.authorization.environment,
        path: workload.authorization.path,
        allowedSecretCount: workload.authorization.secretNames.length,
        inheritedGrantCount: workload.authorization.inheritedGrants.length,
      },
      platformBindings: workload.platformBindings.map((binding) => ({
        platform: binding.platform,
        binding: binding.binding,
        sourceRef: binding.sourceRef,
        authority: binding.authority,
        singleAuthority: binding.authority === 'infisical',
      })),
      revocation: {
        cacheWindowSeconds: workload.revocation.tokenCacheWindowSeconds,
        cacheWindowAcknowledged: true,
        procedure: workload.revocation.urgentProcedure,
      },
      rotation: {
        overlapSeconds: workload.rotation.overlapSeconds,
        healthCheck: workload.rotation.healthCheck,
        reloadBeforeRevoke: workload.rotation.steps.indexOf('reload-consumer') < workload.rotation.steps.indexOf('revoke-old')
          && workload.rotation.steps.indexOf('health-check') < workload.rotation.steps.indexOf('revoke-old'),
        steps: workload.rotation.steps,
      },
    }))

  return { schemaVersion: 1, mutation: false, workloads }
}

async function main() {
  const [command, file] = process.argv.slice(2)
  if (!['validate', 'plan'].includes(command) || !file) {
    console.error('usage: infisical-identity-policy.mjs <validate|plan> <policy.json>')
    return 2
  }

  let policy
  try {
    policy = JSON.parse(await readFile(resolve(file), 'utf8'))
  } catch {
    console.error(JSON.stringify({ valid: false, errors: ['policy file must contain valid JSON'] }, null, 2))
    return 1
  }
  const errors = validatePolicy(policy)
  if (errors.length > 0) {
    console.error(JSON.stringify({ valid: false, errors }, null, 2))
    return 1
  }
  if (command === 'validate') {
    console.log(JSON.stringify({ valid: true, workloadCount: policy.workloads.length }, null, 2))
  } else {
    console.log(JSON.stringify(policyPlan(policy), null, 2))
  }
  return 0
}

process.exitCode = await main()
