# Spec Delta

## Purpose

Defines safe personalized Desktop Tools bootstrap endpoints that remain shareable, nonsecret, portable, and independently verifiable.

## ADDED Requirements

### Requirement: Profile subdomain bootstrap
The system SHALL serve a shell-compatible stage-zero launcher from the root of each valid profile subdomain.

#### Scenario: Start a personalized installation
- **WHEN** a user pipes `https://example.desktop.tools` to Bash
- **THEN** the response starts the `example` profile bootstrap without requiring a path suffix

#### Scenario: Unknown profile
- **WHEN** the requested profile does not exist or is disabled
- **THEN** the endpoint fails without serving a default or another profile

### Requirement: Public response contains no authority
The unauthenticated profile endpoint MUST contain only public bootstrap and nonsecret profile-identification material.

#### Scenario: Shared URL
- **WHEN** a profile URL or response is disclosed to an untrusted party
- **THEN** it grants no secret access, machine enrollment, fleet access, or mutation authority

### Requirement: Verified immutable bootstrap
Stage zero SHALL verify an approved immutable Desktop Tools release before executing downloaded code and SHALL fail closed when trust, freshness, origin, size, or integrity cannot be established.

#### Scenario: Valid release
- **WHEN** the release metadata and artifact satisfy the installed trust policy
- **THEN** stage zero executes the verified local artifact

#### Scenario: Invalid release
- **WHEN** verification, freshness, origin, redirect, size, or integrity validation fails
- **THEN** no downloaded executable is run and no mutable fallback is used

### Requirement: Portable versioned profile
The selected profile SHALL resolve to a versioned nonsecret desired-state document that can be exported and used without the hosted Desktop Tools service.

#### Scenario: Profile retrieval
- **WHEN** an authorized machine resolves a profile revision
- **THEN** the exact revision and digest are bound into its provisioning plan and evidence

#### Scenario: Hosted service unavailable
- **WHEN** the hosted service is unavailable and the operator possesses an exported profile and trusted release
- **THEN** the standalone provisioning path remains available without silently changing the profile

### Requirement: Compatibility migration
Legacy Install Doctor and aid entrypoints SHALL either delegate to an equivalent Desktop Tools flow or fail with explicit migration guidance during a bounded deprecation period.

#### Scenario: Legacy invocation
- **WHEN** an existing supported legacy command or state path is encountered during the migration window
- **THEN** user-owned state is preserved and the operator receives a deterministic migration result

#### Scenario: Removed legacy surface
- **WHEN** a legacy surface has passed its documented deprecation deadline
- **THEN** it does not silently start a different profile or product
