# Spec Delta

## Purpose

Provides secure, automatic browser access to the exact live GNOME desktop on capable estate workstations while preserving host-specific edge identity.

## ADDED Requirements

### Requirement: Capability-based eligibility
Install Doctor SHALL automatically select the live-GNOME remote-desktop baseline only for non-container Linux hosts with a configured GNOME desktop and at least 16 GiB total RAM.

#### Scenario: Eligible workstation
- **WHEN** a Linux GNOME host reports at least 16 GiB total RAM
- **THEN** the KasmVNC reconciliation hook runs unless explicitly opted out

#### Scenario: Ineligible host
- **WHEN** the host is a container, headless, non-Linux, non-GNOME, or below 16 GiB RAM
- **THEN** provisioning exits successfully without installing desktop services

### Requirement: Live-session identity
The remote desktop SHALL share the existing GNOME Wayland session rather than creating a second desktop or container home.

#### Scenario: Browser and console comparison
- **WHEN** a window changes on the physical GNOME session
- **THEN** the same change is visible through KasmVNC

### Requirement: Loopback-only services
Raw VNC and KasmVNC SHALL bind only to loopback. Optional Chromium CDP SHALL be disabled by default and SHALL bind only to loopback when explicitly enabled.

#### Scenario: Listener audit
- **WHEN** health verification inspects governed ports
- **THEN** each configured endpoint is present on loopback and absent from wildcard and LAN bindings

### Requirement: No unrelated application launch
Desktop provisioning SHALL NOT install or launch Paperclip, and SHALL NOT launch persistent Chromium automation unless the operator explicitly enables it.

#### Scenario: Default desktop provisioning
- **WHEN** the KasmVNC baseline is reconciled without browser or application opt-ins
- **THEN** only the live desktop sharing services are enabled

### Requirement: Secret-safe idempotency
Provisioning SHALL generate host credentials locally with restrictive permissions and SHALL not copy, print, or commit them.

#### Scenario: Repeated reconciliation
- **WHEN** the hook runs more than once
- **THEN** existing credentials and browser state are preserved while service definitions converge

### Requirement: Recoverable operations
Install Doctor SHALL provide sanitized inventory, health verification, and service reconstruction artifacts for the reusable desktop chain.

#### Scenario: Recovery evidence
- **WHEN** an operator runs the health and inventory helpers
- **THEN** service state, listener scope, geometry, and non-secret versions are recorded without credential material

### Requirement: Persistent gateway lifecycle
The KasmVNC browser gateway SHALL be owned by the lingering user manager rather than the physical GNOME session, remain available across logout or session unload, and retry the loopback VNC source until the live GNOME desktop returns.

#### Scenario: Physical GNOME logout
- **WHEN** the shared GNOME session exits or reloads
- **THEN** the loopback KasmVNC endpoint remains active
- **AND** the bridge reconnects to the live session after display-manager automatic login restores it

#### Scenario: Laptop lid closes
- **WHEN** a governed workstation is configured for closed-lid service
- **THEN** lid and idle power policy do not suspend the host
- **AND** UPower does not remove the internal panel from GNOME's monitor topology
- **AND** GNOME does not lock or blank the shared physical session
- **AND** KasmVNC remains reachable through the host-specific protected ingress
