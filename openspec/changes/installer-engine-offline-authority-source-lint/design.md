# Design

**Architect Role:** assigned

Use the current Zod timestamp constructor with unchanged offset and length validation. Compare adjacent collection values using the existing locale ordering and retain identity uniqueness checks. Reuse the unsigned projection for both digest checks, excluding only the top-level request digest.

The parsed promotion schema fixes the GitHub Actions issuer independently on both the attestation and the expected CI scope. The subject, workflow reference, and remaining proof bindings continue to be compared. Run the standard strict gate and the focused and full package tests on Node 24.22.2.
