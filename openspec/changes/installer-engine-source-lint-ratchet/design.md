# Design

**Architect Role:** assigned

Reuse the shared strict profile and locked ESLint installed by Aid Core. Lint from the repository root against the Installer Engine production TypeScript project. Keep the full TypeScript source glob open and exclude only the exact measured paths. The package test runs lint after the build emits Aid Core declarations. Linux structural verification builds those declarations before its independent source lint step.

Resolve legacy findings in bounded batches by ownership. Recheck the exact covered set against the baseline and prove an otherwise unlisted source file is subject to lint. This change changes verification and leaves Installer Engine runtime sources intact.
