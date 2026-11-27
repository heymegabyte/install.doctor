## ADDED Requirements

### Requirement: Strict typing for rollback plans and evidence

Rollback plan and journal modules SHALL pass the normal strict source gate.

#### Scenario: Reject invalid rollback approval

- **WHEN** approval does not match the exact plan digest
- **THEN** rollback preparation rejects the promise before recording approval
