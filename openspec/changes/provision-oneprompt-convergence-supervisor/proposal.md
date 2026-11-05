# Provision the OnePrompt convergence supervisor

> **Architect:** codex
> **Architect Role:** assigned

## Why

OnePrompt already has an operator-authorized bounded convergence controller and an installed macOS launchd label, but install.doctor does not yet preserve a portable, idempotent host-service configuration. Reinstalling or moving the controller to an authorized Linux host must not create a second writer, erase an operator pause/stop, or infer a repository path.

## What changes

- Add an opt-in host utility that installs and controls the single `com.heymegabyte.oneprompt-convergence` service on launchd or systemd.
- Require the operator to provide an existing repository and foreground controller; installation never invents a target or starts work implicitly.
- Persist pause/stop intent outside the repository and expose machine-readable status without treating log activity as health.
- Add synthetic lifecycle tests that use fake service-manager commands and never disturb the live service.

## Boundaries

- OnePrompt owns controller policy and the foreground worker command.
- theme.tools owns reusable controller libraries.
- install.doctor owns only portable host/service provisioning and lifecycle control.
- This change does not launch a second writer, deploy OnePrompt, alter the live launchd service, or add credentials.
