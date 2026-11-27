## ADDED Requirements

### Requirement: Strict typed artifact lifecycle checks
Immutable artifact retrieval and lifecycle modules SHALL pass the normal strict gate.

#### Scenario: Run on a platform without a no-follow constant
- **WHEN** the platform does not expose the constant
- **THEN** the existing fallback and subsequent file validation still apply
