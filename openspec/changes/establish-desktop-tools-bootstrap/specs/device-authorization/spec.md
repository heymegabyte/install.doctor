# Spec Delta

## Purpose

Defines secure cross-device authorization for enrolling a graphical or headless machine without embedding reusable credentials in its bootstrap URL.

## ADDED Requirements

### Requirement: Headless device authorization
The bootstrap SHALL create a new device identity and present a bounded human verification code and approval URL that can be completed on another device.

#### Scenario: Headless enrollment
- **WHEN** the target machine has no browser or graphical session
- **THEN** it can wait for approval while displaying the code, expiry, and safe cancellation guidance

### Requirement: Explicit informed approval
Approval SHALL display the profile, machine label and fingerprint, requested scopes, expiration, and actor before allowing or denying enrollment.

#### Scenario: Owner approves
- **WHEN** an authenticated authorized owner confirms the matching code, machine, profile, and scopes
- **THEN** the pending device may claim one scoped enrollment result

#### Scenario: Owner denies
- **WHEN** the owner denies the request
- **THEN** the target receives a terminal denial and no credential is minted

### Requirement: One-time private polling authority
The polling secret SHALL be generated on the target, stored only as protected local runtime state, transmitted only over authenticated encryption, and accepted only for its matching pending request.

#### Scenario: Poll secret replay
- **WHEN** a polling secret is reused after claim, denial, revocation, or expiry
- **THEN** the request is rejected without revealing private enrollment metadata

### Requirement: Scoped short-lived credential
Successful enrollment SHALL issue a device-bound credential with minimum scopes, explicit expiry, and independent revocation.

#### Scenario: Credential use
- **WHEN** the enrolled machine requests profile or session authority
- **THEN** access is limited to its tenant, profile, machine identity, allowed actions, and validity window

#### Scenario: Cross-device access
- **WHEN** the credential is presented for another tenant, profile, machine, or administrative action
- **THEN** access is denied and auditable metadata contains no secret values

### Requirement: Privacy-preserving errors and rate limits
Public authorization endpoints SHALL enforce bounded bodies, expiry, polling intervals, collision handling, and per-principal abuse controls while normalizing sensitive lookup failures.

#### Scenario: Invalid or expired code
- **WHEN** a caller presents a malformed, unknown, expired, denied, or claimed code
- **THEN** the response does not distinguish private device state beyond the minimum protocol status

#### Scenario: Excess polling
- **WHEN** a target polls faster than allowed
- **THEN** it receives bounded retry guidance without extending authorization lifetime
