- [x] Verify and stage the upstream signed-app LaunchAgent with idempotent behavior.
- [x] Deploy on the enrolled Mac and prove its running driver remains active.
- [ ] Verify next-login activation and actual OS permission behavior during coordinated maintenance.

November 28 canary for `422c68cb`:

- The enrolled Mac verified the signed app and staged
  `~/Library/LaunchAgents/com.trycua.cua-driver.plist` with SHA-256
  `51ef2cce2c23fee7134fab4813300467c544b03c2bf6e6bca1097be3b162e838`.
  Reapply kept the same digest. The current native daemon retained
  PID 9739 and the new job remained unloaded. The current daemon
  reported both Accessibility and Screen Recording granted.
- A custom LaunchAgent in an isolated home returned exit 78 and
  kept its original digest. The runtime authority, headless, and
  corrupt-download checks passed.
- The installed hook SHA-256 is
  `e88e7fb8cc20f9ac78a322c4018486d26ba31241e9f2ead7f1fa0673966ca777`.
  The prior hook is retained at
  `~/.local/state/install-doctor/cua-hook-rollback-93dec5b2`.
  To withdraw the staged launcher before login, verify it is
  unloaded and matches the recorded digest before unlinking it.
  The prior hook unloads and reloads its own launcher during
  normal apply, so review that behavior before restoring it.

The canary measured the current daemon's permissions. LaunchAgent
startup and TCC behavior after the next login remain pending.
