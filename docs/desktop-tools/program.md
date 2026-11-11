# Desktop Tools 50-initiative program

The program ledger is `config/desktop-tools-program.json`. It gives every initiative from I01
through I50 one capability, one owning OpenSpec change, one horizon, implementation and verification
paths, host targets, and an explicit state. The ledger does not copy work from an owning change;
the audit links to that change's task ledger and records its content digest as freshness evidence.

## Capability truth

Planning and contracts are not shipped capability. Use these states precisely:

- `planned`: accepted work with no implementation claim.
- `in-progress`: owned implementation work; not a deployment claim.
- `BLOCKED`: a required authority or prerequisite is absent.
- `UNVERIFIED`: implementation or policy exists but required evidence does not.
- `complete`: implementation and its required verification evidence are complete.

Generated configuration, a started process, or a queued job is never enough to promote a capability.
Production truth requires target-bound evidence from the relevant owner and admission gate.

## Horizons and operation

The five ordered horizons are trust foundation, production vertical slice, platform and operations,
product experience, and ecosystem scale. A later horizon reports `waiting-on-dependency` until every
initiative in its prerequisite horizons is complete. Admission gates block only their listed
initiatives, leaving unrelated safe work visible in each horizon's `ready` list.

Generate the deterministic audit report with:

```bash
node scripts/audit-desktop-tools-program.mjs \
  --output .agent/desktop-tools-program-report.json
```

The report inventories current release, mutation, identity, secret, desired-state, observed-state,
telemetry, backup, UI, and platform-evidence authorities. Desired state and observed evidence are
separate authorities. It also reports owner task progress and digest, admission blockers, path
presence, effective initiative state, critical path, and work in progress. Invalid schemas,
duplicate authorities, unknown owners, or an unevidenced passing gate fail closed.
