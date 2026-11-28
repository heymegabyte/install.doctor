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
