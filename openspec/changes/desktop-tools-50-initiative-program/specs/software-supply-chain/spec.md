# Spec Delta

## Purpose

Defines trustworthy admission and lifecycle management for software recipes, dependencies, upstream artifacts, plugins, skills, models, and extensions.

## ADDED Requirements

### Requirement: Catalog entries form a strict closure
Every selectable entry SHALL declare identity, version policy, platforms, roles, architecture, dependencies, conflicts, load policy, privilege, network exposure, install, detect, update, uninstall, configure, verify, provenance, license, and support evidence.

#### Scenario: Entry has an unknown field or dependency
- **WHEN** catalog validation encounters an undeclared field, missing dependency, cycle, or unsupported platform claim
- **THEN** generation and release admission fail deterministically

### Requirement: Executable recipes are immutable and verified
Every executable recipe and fetched artifact SHALL resolve to immutable authenticated evidence with bounded transport and no mutable remote-code fallback.

#### Scenario: Preferred provider is unavailable
- **WHEN** an authenticated preferred provider cannot satisfy the pinned recipe
- **THEN** installation fails with remediation instead of executing an unverified fallback

### Requirement: Security evidence follows the shipped closure
Each release SHALL publish software and applicable AI/data inventories, vulnerability findings, exploitability statements, licenses, provenance, and policy decisions bound to exact shipped digests.

#### Scenario: Vulnerability applicability changes
- **WHEN** new evidence changes exploitability without changing shipped bytes
- **THEN** the versioned exploitability statement updates without rewriting the original inventory

### Requirement: Extensions are signed and least privilege
Plugins, skills, integrations, and agents SHALL declare compatible API versions and exact capabilities, pass isolated tests, carry trusted signatures and provenance, and support revocation before loading.

#### Scenario: Extension requests excess authority
- **WHEN** an extension declares or attempts authority outside the approved profile and task
- **THEN** admission or execution denies it without affecting the core lifecycle
