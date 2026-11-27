## Verification

- [x] Enable strict source lint for the four authorization contract modules.
- [x] Verify canonical prompt and ownership behavior with the full Installer Engine suite.

Node 24.22.2 passed the build, source lint, test typecheck, and 640 runtime tests with nine skips. An independent before/after probe matched canonical prompt bytes and hashes and verified rejection of invalid and unexpected digest fields. Eleven timestamp and UUID examples preserved the baseline outcomes.
