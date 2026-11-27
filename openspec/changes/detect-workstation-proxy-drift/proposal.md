# Detect workstation artifact proxy drift

**Architect Role:** assigned

## Why

The workstation doctor can report a healthy loopback artifact proxy while an older daemon routes first-party npm misses to the public registry. Its current health check records HTTP status and runtime only.

## What Changes

Verify the selected proxy artifact against the installed source and the running service. Add a targeted reconciliation path with a verified rollback artifact and explicit restart impact.

## Impact

Workstation diagnostics can surface stale proxy policy even while serving cached requests. Local operators can reconcile the proxy without reprovisioning package-manager configuration.
