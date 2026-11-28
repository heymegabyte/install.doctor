> **Architect:** codex
> **Architect Role:** assigned

## Why

Selected Cua provisioning fails on a fresh desktop because the hook requires a preinstalled binary. Legion and the enrolled Mac both currently use Cua Driver 0.44.0.

## What Changes

Provision the official digest-pinned Cua Driver release on supported desktop architectures when no driver is installed. Preserve existing native installations and user permission decisions.

## Capabilities

### New Capabilities

- `cua-runtime-artifact`: Verify and stage the official desktop driver release.

## Impact

Install Doctor's selected desktop post-install path and its offline failure behavior.
