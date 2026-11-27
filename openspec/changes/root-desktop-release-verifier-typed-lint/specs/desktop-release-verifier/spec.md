## ADDED Requirements

### Requirement: Typed offline verifier gate

The package tooling lint command SHALL check the offline verifier with the shared strict profile and the Control Plane tooling TypeScript project.

#### Scenario: Tooling lint checks the offline entry point

- **WHEN** a developer or the Linux workflow runs the Control Plane tooling lint command
- **THEN** the command checks the offline release verifier and fails if it reports a strict lint finding

#### Scenario: Signed release is verified locally

- **WHEN** the verifier receives a complete release directory and the expected public key
- **THEN** it verifies the SSH signature over the exact manifest bytes and reports the verified release identity
