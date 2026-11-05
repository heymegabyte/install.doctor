# Design: portable OnePrompt convergence service

> **Architect:** codex
> **Architect Role:** assigned

## Contract

The utility accepts `install`, `start`, `status [--json]`, `logs`, `pause`, `resume`, `stop`, `uninstall`, and `verify`. It uses one stable service label and one durable intent directory under XDG state. `install` validates an absolute existing repository path, an executable foreground controller, and the detected service manager before atomically rendering a user service definition. It installs but does not start the service. An unmanaged canonical definition fails closed rather than being overwritten.

`start` refuses while stop intent is present; `resume` clears explicit pause/stop intent and revalidates the installed definition before starting. `pause` persists intent before asking the service manager to stop. `stop` persists stop intent before stopping. A later service-manager wake therefore cannot override explicit operator intent because the foreground wrapper checks intent before every admission. launchd `StartInterval=900` and a systemd timer provide bounded watch wakeups without KeepAlive-on-failure. `status --json` reports the intended mode independently from service-manager state and heartbeat freshness. `uninstall` first persists stop, removes only an adapter-managed definition, and retains logs and stop intent.

## Ownership and duplicate prevention

The existing OnePrompt controller remains responsible for its single-instance lock and mutation fencing. The host utility uses the canonical label only and rejects an installed definition whose repository or executable differs unless the operator explicitly runs `install` with the desired exact configuration. It never creates a second label or starts on install.

## Security and telemetry

No secret values enter service definitions, state, or logs. Environment is an allowlisted minimal PATH and HOME. Status reads bounded state and service-manager output. Heartbeat freshness is determined from the controller-owned heartbeat file when present, not from log output.

## Rollout and rollback

The utility is distributed by chezmoi as an executable but remains inert until invoked. Existing manually installed services remain untouched by this implementation pass. Rollback removes the generated user service only after an explicit future operator action; this change adds no automatic uninstall.
