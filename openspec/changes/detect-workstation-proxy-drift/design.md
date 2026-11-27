# Design

**Architect Role:** assigned

Use the package proxy source already kept in sync with the provisioning hook. Record the selected artifact digest and its source revision when provisioning or applying an explicitly approved local backport. Verify those bytes against the installed source. Bind the launch receipt to the selected bytes and running instance so replacing a file cannot make a stale listener appear current. A missing identity is unverified even when HTTP health succeeds.

Reconciliation targets the registered workstation proxy service and its executable source. Stage the selected bytes beside the installed path, verify their digest and runnable mode, and retain the prior bytes and mode for rollback. Run the existing synthetic outage fixture against the staged candidate. Coordinate the restart with local package qualification and other active consumers because a restart can interrupt requests on port 4880. Use the existing launchd or systemd service entry point for that host.

After reconciliation or rollback, verify the installed digest, the service PID and loopback socket, HTTP health, and a public package smoke check. Verify first-party request confinement in the isolated fixture using a mock Nexus and mock public registry. Never use a real first-party cold miss to exercise a fallback.
