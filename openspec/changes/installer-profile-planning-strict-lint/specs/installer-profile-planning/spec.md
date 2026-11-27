## ADDED Requirements

### Requirement: Strict typed lint for installer profile planning
The profile compilation, desired-state, portable profile, and lazy plan sources SHALL pass the strict source gate.

#### Scenario: Recompute deterministic profile evidence
- **WHEN** a previously valid profile or lazy plan is evaluated
- **THEN** the same canonical digest and package closure rules apply
