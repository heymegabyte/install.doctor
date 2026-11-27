# Tasks

- [x] Resolve both derivations' strict lint findings and retire their exceptions.
- [x] Verify strict lint and the pinned Installer Engine suite.

Both derivations passed the standard strict gate with zero findings on Node 24.22.2. All nine focused tests passed. The full suite passed 640 runtime tests with nine platform-gated skips. A direct service derivation probe confirmed the systemd manager requirement.
