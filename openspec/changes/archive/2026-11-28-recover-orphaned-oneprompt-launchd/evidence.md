# Verification

- The original adapter rejected the explicit predecessor option. The real workstation has a loaded, nonrunning definition with an absent pinned working directory and durable stopped controller intent.
- The disposable launchd fixture rejects a mismatched pin, a failed unload, an injected install failure and an unrelated definition. The original definition stays byte-identical on failure. Successful adoption is inert and rollback restores the original plist while keeping SQLite stopped.
- The fixture verified the SQLite-consistent recovery snapshot with quick_check. All supervisor shell assertions and all 13 pinned OnePrompt adoption tests passed.
- The test used exact vendored OnePrompt packages from the published adapter pin. An offline npm install lacked cached luxon, so third-party fixture tools were linked from the existing test checkout and the pinned vendored archives installed separately.
- Codex owned this sensitive host-state transition. Independent review found replacement pinning, post-unload failure recovery, and WAL-consistent backup gaps, all handled in the final patch. No workstation daemon, intent, adapter binary or plist was changed.
