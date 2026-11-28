> **Architect:** codex
> **Architect Role:** assigned
> Current architecture ownership reviewed November 28, 2026.

## Why

Selecting the Install Doctor Cua desktop hook currently grants desktop tool access to multiple agent harnesses and can replace malformed operator configuration. Driver setup needs its own authority boundary.

## What Changes

- Remove implicit agent configuration and skill registration from the desktop hook.
- Keep desktop startup and existing operator-managed harness configuration intact.
- Document explicit registration as a separate operator action.

## Capabilities

### New Capabilities

- `cua-desktop-provisioning`: Scope native driver provisioning separately from agent capabilities.

## Impact

Install Doctor Cua post-install hook and operational documentation.
