# Tasks

- [x] Enable strict typed lint for the measured clean source paths and new source files.
- [x] Run the gate from the package test and the Linux structural workflow.
- [x] Verify exact coverage, a failing new-file probe, the package suite, and workflow syntax.

On Node 24.22.2 the package gate checked exactly the 14 measured clean source files. A temporary new source file produced one `@typescript-eslint/no-floating-promises` finding and was removed. The package suite completed with 640 passing and nine platform-gated skips. The full check included all four bundle builds and the test compiler. The exact Linux lint commands passed locally, and Actionlint and strict OpenSpec validation passed.
