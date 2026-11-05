# OnePrompt convergence host supervisor

install.doctor provides the portable host-service layer for OnePrompt's bounded foreground convergence controller. OnePrompt owns controller policy and theme.tools owns reusable controller libraries. This utility never creates a second scheduler identity and does not start work as a side effect of installation.

## Install on an authorized host

The OnePrompt checkout and its executable `scripts/run-convergence-loop.sh` must already exist. Install the service definition with the exact checkout path:

```bash
oneprompt-convergence-supervisor install \
  --repo /absolute/path/to/oneprompt.site-2
oneprompt-convergence-supervisor verify
oneprompt-convergence-supervisor status --json
```

`install` is byte-stable and inert. It writes the canonical launchd user agent on macOS or systemd user service on Linux but does not register or start it. This prevents provisioning from racing an existing controller.

## Lifecycle

```bash
oneprompt-convergence-supervisor start
oneprompt-convergence-supervisor status --json
oneprompt-convergence-supervisor logs
oneprompt-convergence-supervisor pause
oneprompt-convergence-supervisor resume
oneprompt-convergence-supervisor stop
oneprompt-convergence-supervisor uninstall
```

Pause and stop intent is stored under `${XDG_STATE_HOME:-$HOME/.local/state}/oneprompt-convergence`, outside the repository. `start` refuses to override either intent. `resume` is the explicit operator action that clears persisted pause/stop intent, revalidates the installed definition, and starts it. The service wakes at a bounded 15-minute interval, and the foreground wrapper rechecks intent before every admission. It never uses KeepAlive-on-failure. `uninstall` works only for a definition previously installed by this adapter, persists stop intent first, removes the definition, and retains logs and intent for recovery.

The OnePrompt repository should expose its required package-manager-native `converge` commands as thin wrappers around controller and host contracts. This install.doctor utility is the host adapter, not a competing OnePrompt task database or scheduler.

## Health semantics

Machine-readable status separates:

- desired mode (`running`, `paused`, or `stopped`);
- supervisor service state;
- controller heartbeat freshness; and
- the combined healthy verdict.

Log activity is never treated as a heartbeat. The foreground controller must update the configured heartbeat after meaningful checkpoints. Until OnePrompt emits that heartbeat and adopts the durable intent path, host status correctly reports missing or stale evidence rather than claiming health.

## Safety and recovery

- One canonical identity is used: `com.heymegabyte.oneprompt-convergence` on launchd and `oneprompt-convergence.service` on systemd.
- An existing unmanaged canonical definition causes installation to fail closed; it is never silently overwritten or duplicated.
- The service runs in the foreground and uses no nested daemonization.
- No credentials are stored in the definition. Provider secrets remain in the established secret authority.
- The current controller's own lock and publication fencing remain authoritative for duplicate-writer protection.
- Synthetic lifecycle tests use temporary homes and fake service-manager binaries. They do not crash or restart live migration work.
- A macOS LaunchAgent is interrupted by user logout and machine sleep. Prefer the already-authorized always-on Linux host when its identity, repository checkout, credentials, and operator ownership are verified.

Run the isolated verification with:

```bash
bash scripts/test-oneprompt-convergence-supervisor.sh
```
