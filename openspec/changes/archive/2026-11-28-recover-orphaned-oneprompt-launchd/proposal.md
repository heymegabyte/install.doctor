## Why

An inactive OnePrompt launchd predecessor can outlive its immutable checkout and host-adapter config. The supported adoption command rejects the surviving definition even when the operator has a qualified replacement.

## What Changes

- Permit explicit recovery of a missing predecessor checkout after exact definition and replacement validation.
- Preserve the recovery bundle and stopped state. Leave unrelated or active services untouched.

## Capabilities

### Modified Capabilities

- `oneprompt-convergence-supervisor-health`

## Impact

The install.doctor OnePrompt host adapter and mock-manager verification change. The adoption command remains inactive after success.
