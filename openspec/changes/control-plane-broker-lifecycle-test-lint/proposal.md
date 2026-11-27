# Apply strict lint to broker and credential lifecycle tests

**Architect Role:** assigned

## Why

Run-intent and credential rebuild fixtures exercise authority decisions and durable credential transitions. Their mock handlers and evidence formatting generate diagnostics under the shared strict profile.

## What changes

Use explicit promise returns and numeric formatting in the relevant fixtures. Keep authority rejection and lifecycle assertions intact.

## Impact

This change applies only to the two test suites. Verification uses local fixture state.
