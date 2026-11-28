> **Architect:** codex
> **Architect Role:** assigned

Use machine-readable logind session properties on Linux. Require a
nonremote active X11 or Wayland session, a physical seat and a regular
user session with the same UID. On macOS require the console UID
and the corresponding launchd GUI domain. Ignore SSH and display
environment variables for eligibility. Report this gate before
configuring or starting the driver. OS permission and functional input
verification remain independent.

[systemd logind session properties](https://www.freedesktop.org/software/systemd/man/latest/org.freedesktop.login1.html)
