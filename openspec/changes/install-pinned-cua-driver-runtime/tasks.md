- [x] Wire the verified fresh artifact path into the selected Cua hook, preserving installed runtimes.
- [x] Validate real Linux and macOS release artifacts, reject a wrong digest, and exercise headless and reapply cases.
- [ ] Verify the selected native rollout with desktop permission and actual session operation on representative enrolled desktops.

On November 28, 2026 the selected hook fetched, verified and installed
the official Linux x86_64 archive into an isolated home on Legion with
user service activation stubbed. The native CLI reported 0.44.0; a
second installer run preserved the command link. Linux arm64 archive
bytes matched their pin. The Mac verified the extracted universal
application's signature against the pinned bundle identifier and team,
and its executable reported 0.44.0. Existing apps and daemons were left
running. The corrupt-download fixture rejected the payload and left no
command or staging directory. The default-disabled, headless, and
agent-configuration preservation controls remain in place.

An interactive fresh Mac activation, native permissions, and Linux
Wayland helper compatibility are still pending. The pinned helper
declares GNOME 45–49; fresh GNOME 50 window geometry needs its own
supported helper and live session verification.

Install Doctor `4083c6d0` is staged on the live Legion account.
The installed helper SHA-256 is
`02013e810f8c8911a7b9e4a1409c08bbd62756a567ae6535c20dbbc071dcb609`.
The existing Legion hook was patched only at its absent-runtime
branch, resulting in SHA-256
`6f424a651491cab88136febde343b72df00bb9f2f98dd09bff5dece891d5bf33`.
Its selected headless run skipped correctly. The active user daemon
remained on PID 1230329. The prior hook is retained at
`~/.local/state/install-doctor/cua-hook-rollback-ed8aa757`.
Restore it atomically if this provisioning change must be rolled back.

A November 28 upstream readback compared the WinRects helper at
[`cua-driver-rs-v0.44.0`](https://github.com/trycua/cua/blob/cua-driver-rs-v0.44.0/libs/cua-driver/wayland-helper/winrects%40cua/metadata.json)
and [`cua-driver-rs-v0.67.0`](https://github.com/trycua/cua/blob/cua-driver-rs-v0.67.0/libs/cua-driver/wayland-helper/winrects%40cua/metadata.json).
Both declare helper version 12 and support GNOME Shell 45–49 in
their metadata. Legion runs GNOME Shell 50.1. Its installed helper
declares versions 45–51 and its extension code matches upstream
0.44.0 byte for byte, with SHA-256
`b7b5b922e68a8ee53eb549a3d2f85dd28259140633c0c34123f16910f7ac8e0c`.
Upstream 0.67.0 has different extension code but still omits 50
from the supported shell versions. Preserve the currently operating
session and keep fresh GNOME 50 helper activation conditional on
supported upstream metadata and a representative session test.

Install Doctor `e562b9fe` now checks the bundled helper's declared
GNOME major version and preserves an existing helper. The Linux
fixture from `ed32d9f3` passed on Legion under the managed desktop
account. It exercised an unsupported GNOME 50 bundle, a declared
GNOME 49 bundle, and preservation of existing extension metadata.

The helper guard was applied to Legion's effective provisioning
hook with its host-specific selection and autostart behavior intact.
The installed hook digest is
`2f883b108910152fa84c2f3e02d7f8a7aa689321da643640c494eabf3370bcc1`.
The deployed `--check-session` entry point recognized the active
physical Wayland session from SSH with both display variables
unset. The Cua service PID stayed at `1230329` and the installed
WinRects metadata digest stayed at
`da8b438865f98e6edf3ad1eed93e7a3121f906ff13d75504e6a4264d82c161c5`.
The pre-change hook is retained at
`~/.local/state/install-doctor/cua-hook-rollback-5772c1d5`.
This live readback covers discovery and preservation. Fresh
GNOME 50 helper activation remains conditional.

The enrolled Omen desktop was running a legacy hook that downloaded
an unpinned installer and registered the driver with agent harnesses.
The scoped rollout replaced that hook and added the two missing
runtime and Linux autostart helpers from upstream Install Doctor.
The existing host-specific default-enabled selection was retained.
The deployed hook digest is
`97adbe97863f195736218d2e7d4bd10a60bd9f73b64ae543fcdaf772aae7a2a7`.
Session detection over SSH and explicit headless skip passed.
The existing daemon remained on PID `759228`. No harness configuration
was rewritten or revoked by the rollout. The previous hook is stored
at `~/.local/state/install-doctor/cua-hook-rollback-b51b2542`.
