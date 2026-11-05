# Verification evidence

Verified on 2026-11-04 on the current macOS workstation without mutating the live service.

## Live observation

- Installed label: `com.heymegabyte.oneprompt-convergence`.
- Definition: `/Users/Apple/Library/LaunchAgents/com.heymegabyte.oneprompt-convergence.plist`; `plutil -lint` passed.
- Exact controller: `/Users/Apple/emdash/repositories/oneprompt.site-2/scripts/run-convergence-loop.sh`.
- Working directory: `/Users/Apple/emdash/repositories/oneprompt.site-2`.
- Current supervisor state: registered, not running, zero active processes.
- Last terminal result: exit 76 after the configured twelve-pass hard ceiling.
- Last recorded checkpoint: OnePrompt commit `c1c7c31d2818a1ec05d868f3dd261d0f5400b23a`; the controller log records successful checks, deployment version `fcfcc64d-fb7f-4aac-910c-9cd595efa8ae`, production smoke, commit, and push before bounded exit.
- Duplicate writer scan: no `run-convergence-loop.sh` or `opencode-deepseek.sh run` process was active.
- Persistence limitation: this is a per-user macOS LaunchAgent. It does not establish continuity across logout or workstation sleep; battery sleep is configured for 30 minutes.

The live definition predates the install.doctor adapter and is intentionally not adopted or restarted in this change. OnePrompt does not yet emit the adapter heartbeat or consume its durable pause/stop intent. Therefore full launch/recovery acceptance remains an integration blocker, not a claimed pass.

## Synthetic verification

`bash scripts/test-oneprompt-convergence-supervisor.sh` passed all isolated assertions:

- byte-stable repeated launchd installation;
- no start or registration during install;
- canonical single-label start;
- pause persistence before stop;
- explicit resume;
- durable stop blocking start;
- stale-heartbeat unhealthy classification;
- installed-definition verification; and
- inert systemd unit generation.

