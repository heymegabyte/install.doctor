- [x] Gate Cua setup on the selected user's local graphical session and expose a non-mutating preflight.
- [x] Test positive local sessions and deny forwarded, headless, remote, greeter, and other-user cases.
- [x] Verify the deployed preflight from Legion SSH and on the managed Mac.

November 28 live canary for Install Doctor `d9e377e0`:

- Legion SSH with both display variables unset found the operator's
  local Wayland seat through logind. Headless preflight returned
  inapplicable. The installed hook SHA-256 is
  `a72552ff39e9115917cb8710cc85dfe6c764e3dbaf6f9f03e5b18c83f76570c3`.
  The user service stayed active on PID 1230329. Rollback copy:
  `~/.local/state/install-doctor/cua-hook-rollback-6f424a65`.
- The managed Mac's console UID and launchd GUI domain accepted the
  deployed check. The headless check returned inapplicable. The Mac
  received the pinned installer and the previously shipped removal of
  automatic harness edits along with the gate. The installed hook
  SHA-256 is
  `93dec5b29238a2240767c067c86c7bc92425d0b2908c749bc7ae63dad8319137`.
  Cua process IDs were unchanged. Rollback copy:
  `~/.local/state/install-doctor/cua-hook-rollback-b51b2542`. That
  revision includes the unpinned installer and automatic harness edits.

Both canaries kept their existing host selection default. The live
tests checked eligibility only; no OS permission, running daemon,
desktop input, or agent configuration was changed by the preflight.
