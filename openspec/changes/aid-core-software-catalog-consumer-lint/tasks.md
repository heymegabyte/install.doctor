# Tasks

- [x] Include the standalone software catalog verifier in normal Aid Core typed checks.
- [x] Verify package gate reach and valid and malformed catalog behavior on pinned Node.

On Node 24.22.2, all 247 Aid Core tests passed. The compiler file list and ESLint configuration show exact verifier coverage. The CLI accepted 1,064 generated catalog entries and rejected a malformed entry. Two calls in the same process loaded distinct schema module URLs after a fixture changed the built module modification time.
