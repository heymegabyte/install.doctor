# Tasks

- [x] Add an exact canonical revision and digest pin.
- [x] Implement verified host-profile acquisition and closed host selection.
- [x] Implement deterministic planning, collision-safe client merge, and unknown-entry preservation.
- [x] Implement explicit transactional apply with protected snapshots and metadata-only receipts.
- [x] Implement drift-safe rollback.
- [x] Add focused digest, host routing, collision, preservation, atomicity, and rollback tests.
- [x] Document operator workflow and runtime-secret-reference behavior.
- [x] Run repository validation, commit, and push the verified change to `origin/main`.
- [x] Apply the descriptor-only Ubuntu canary from a clean pinned worktree without touching the dirty host checkout; verify exact `ubuntu-human` and `ubuntu-automation` profiles, canonical revision/digest, one public OS grant per profile, and mode-`0600` descriptor/rollback receipt. Client-native registration remains a separate gated change.
- [x] Apply the descriptor-only macOS canary; verify exact `macos-human` and `macos-automation` profiles, the same canonical revision/digest and public OS grants, and mode-`0600` descriptor/rollback receipt. Preserve every existing client registration pending native-adapter verification.
