# Proposal

## Why

The bounded OnePrompt convergence worker correctly exits between launchd or systemd timer invocations, but the host adapter currently reports every non-running manager process as `inactive` and unhealthy. This makes a loaded, scheduled service with durable `running` intent indistinguishable from an unloaded supervisor and prompted unnecessary manual restarts.

## What Changes

- Report a loaded timer-driven supervisor between invocations as `scheduled`, distinct from both `active` execution and an absent/inactive definition.
- Treat the scheduled waiting state as healthy only when durable intent is `running`, there is no current owner, the worker is waiting, and the managed artifact remains compatible.
- Add isolated launchd and systemd lifecycle tests for active, scheduled, paused/stopped, and missing-manager states.

## Capabilities

### New Capabilities

- `oneprompt-convergence-supervisor-health`: Portable observation and health classification for active and timer-scheduled OnePrompt convergence supervisors.

### Modified Capabilities

None.

## Impact

This affects `home/dot_local/bin/executable_oneprompt-convergence-supervisor`, its disposable manager fixtures, operator status output, and the installed adapter used by OnePrompt. It does not change worker admission, scheduling cadence, durable intent, or credentials.
