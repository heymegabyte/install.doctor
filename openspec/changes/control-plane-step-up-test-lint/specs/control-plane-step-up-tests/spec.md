## ADDED Requirements

### Requirement: Strict typed HTTP step-up fixture

The Control Plane HTTP step-up integration fixture SHALL pass shared strict typed lint and continue to exercise the existing challenge, consumption, revocation, and recovery behavior through local worker responses.

#### Scenario: HTTP step-up fixtures verify locally

- **WHEN** the HTTP step-up integration fixture runs
- **THEN** it validates relevant response fields and exercises the signed-in user lifecycle with local provider and storage fixtures
