# Spec Delta

## Purpose

Defines compromise-resistant release production and consumption from upstream artifact admission through target verification, promotion, revocation, and rollback.

## ADDED Requirements

### Requirement: Release trust is delegated and threshold-capable
The release system SHALL separate offline root, platform and channel targets, snapshot, timestamp, build, publish, activate, monitor, and emergency-revocation authority with bounded validity and rotation overlap.

#### Scenario: Online signer compromise
- **WHEN** an online delegated signer is revoked or expires
- **THEN** clients reject new authority from it while independently valid historical recovery evidence remains verifiable

### Requirement: Every release has independently verifiable provenance
Every shipped artifact SHALL be digest-bound to source, declared inputs, an approved isolated builder, reproducibility evidence where supported, licenses, and a release SBOM.

#### Scenario: Provenance builder mismatch
- **WHEN** an artifact attestation names an unapproved workflow or builder identity
- **THEN** publication and activation fail regardless of artifact checksum validity

### Requirement: External artifacts enter through immutable admission
Third-party artifacts SHALL be resolved, verified, scanned, licensed, mirrored immutably, and assigned explicit upstream and Desktop Tools provenance before selection.

#### Scenario: Upstream tag is retargeted
- **WHEN** an upstream mutable reference resolves to bytes different from admitted evidence
- **THEN** the system treats it as a new candidate and never substitutes it into an existing release

### Requirement: Promotion is staged and reversible
Release activation SHALL support canary and bounded cohorts, health gates, compare-and-swap promotion, automatic suspension, exact rollback, and independently verified activation receipts.

#### Scenario: Canary verification fails
- **WHEN** a canary produces a failed, stale, or incomplete required receipt
- **THEN** dependent promotion stops while unrelated prior cohorts retain their current verified release
