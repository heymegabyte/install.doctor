# Tasks

## 1. Contracts and doctrine

- [x] 1.1 Record eligibility, security, recovery, and host-boundary behavior in OpenSpec and verify strict validation.
- [x] 1.2 Update agent infrastructure doctrine so reusable host changes must be incorporated into Install Doctor in the same turn and validate the changed rules with strict OpenSpec validation; record unrelated pre-existing repository validator failures.

## 2. Installer implementation

- [x] 2.1 Add failing eligibility and security tests covering Linux/GNOME/16 GiB gates, opt-out, loopback ports, provisioner-neutral service identity, and removal of Legion-specific assumptions.
- [x] 2.2 Generalize the bridge runner and implement idempotent service/credential/browser reconciliation; verify focused tests pass.
- [x] 2.3 Document the universal-versus-host-specific boundary and verify focused documentation and shell contracts pass.

## 3. Live integration

- [x] 3.1 Install the reusable helpers on Omen while retaining its working host-named units; verify loopback listeners, live GNOME framebuffer, tunnel health, no Paperclip process, and no default Chromium unit.
- [ ] 3.2 Run repository verification and produce a migration/parity receipt; archive only when no required work remains.
- [x] 3.3 Decouple the KasmVNC gateway from `gnome-session.target` so a lingering user manager preserves the browser endpoint and reconnect loop across logout.
- [x] 3.4 Add reusable UPower and GNOME closed-lid policy so the physical display remains an active, unlocked VNC source.

## 4. Firewall enforcement

- [x] 4.1 Add a failing-first firewall contract test covering enabled state, default-deny policy, privilege failure, and host-neutral exceptions; verify it passes.
- [x] 4.2 Remove Legion-specific IP/service cleanup from the universal hook and verify enforcement from UFW configuration plus live status.
- [x] 4.3 Enable and verify persistent UFW enforcement on Omen with default-deny input/routing and explicit loopback/LAN SSH recovery access.
- [ ] 4.4 Install and enable Fail2ban on Omen after resolving the unrelated Netdata package failure in its legacy all-in-one hardening script.
