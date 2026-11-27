# Design

**Architect Role:** assigned

Use the current Zod timestamp constructor with the existing offset rules. Keep the Qubes input schema refinement and narrow the validated qrexec request with an explicit invariant check before evaluating it. Verify all three modules against the shared strict profile and the pinned Installer Engine test suite.
