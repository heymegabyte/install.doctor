# Enforce strict typed lint across clean Control Plane source modules

Audit at `491c7e59` with Node 24.22.2 found 1,003 strict ESLint errors and no warnings across 34 production modules. Fourteen modules are clean. Enforce strict source lint for those modules and new modules to prevent regressions in the source tree. Priority is high following completion of the fixture gate.

Use the existing shared strict preset and generated Wrangler runtime declarations. Source remediation belongs to separate bounded changes. The index entry point is the largest dependent change.
