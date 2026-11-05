# Spec Delta

## ADDED Requirements

### Requirement: Capable desktops receive remote access
Automatic provisioning SHALL reconcile the live-GNOME KasmVNC baseline on configured Linux GNOME desktops with at least 16 GiB RAM unless the operator explicitly opts out.

#### Scenario: Default eligible provisioning
- **WHEN** Install Doctor runs on an eligible host without an opt-out
- **THEN** it invokes the idempotent KasmVNC post-install reconciliation

### Requirement: Persistent hosts enforce a firewall
Automatic provisioning SHALL enable and verify a default-deny inbound and routed firewall on every supported persistent host, with host-specific administrative exceptions supplied explicitly.

#### Scenario: UFW service runs but enforcement is disabled
- **WHEN** `ufw.service` is active while `/etc/ufw/ufw.conf` does not contain `ENABLED=yes`
- **THEN** provisioning treats the host as unprotected and enables UFW or reports a blocking privilege failure

#### Scenario: Host-specific exception
- **WHEN** a permanent administrative source needs direct SSH access
- **THEN** the host supplies the source CIDR and port instead of embedding another machine's IP addresses in shared logic
