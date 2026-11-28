> **Architect:** codex
> **Architect Role:** assigned

## Why

The generated user unit runs under the default user target, including lingering user managers without an active GUI. It also hardcodes display socket names.

## What Changes

Use only the graphical session target and the user manager's session environment. Migrate the known legacy unit without restarting an active driver. Preserve other unit definitions.

## Capabilities

### New Capabilities

- `cua-linux-lifecycle`: Bind the driver lifetime to the Linux graphical session.
