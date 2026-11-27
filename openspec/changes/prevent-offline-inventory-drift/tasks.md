# Tasks

- [x] Put the check in the Linux workflow after the Aid Core build and document the refresh command.
- [x] Add a deterministic verification and refresh step using tracked filenames.
- [x] Prove that a new or removed template changes the expected digest, and that a refresh never changes exception policy.

An isolated Git index probe rejected stale metadata before and after removing a staged fixture filename. Refresh restored the check, and the reviewed exceptions compared equal before and after. All template fixtures were empty.
