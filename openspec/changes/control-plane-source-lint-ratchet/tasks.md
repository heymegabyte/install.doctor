# Tasks

- [x] Configure the strict source profile with measured exact-path exceptions.
- [x] Connect it to the normal package suite and GitHub Linux after runtime type generation.
- [x] Compare checked paths to the clean baseline and prove a new file receives strict diagnostics.
- [x] Verify the package suite.
- [x] Verify the exact hosted lint step.

The gate checked exactly the 14 measured clean paths. A temporary new source module triggered the expected floating promise diagnostic and was removed. All 171 package tests passed on Node 24.22.2. Actionlint and strict OpenSpec validation passed.

GitHub Linux passed the combined Control Plane types and lint step at `34252ef8` in run `45939674893`.
