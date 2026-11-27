## ADDED Requirements

### Requirement: Strictly check installer evidence calculations
Performance qualification, fleet budgets, and operational SLO modules SHALL pass strict typed lint.

#### Scenario: Evaluate existing evidence
- **WHEN** the evidence satisfies the existing schemas
- **THEN** digest calculation, aggregate output and failure reporting use the same data and formatting
