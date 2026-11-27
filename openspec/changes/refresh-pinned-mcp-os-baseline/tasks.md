# Tasks

- [x] PIN-1 (Owner: change owner; Depends: canonical control-plane commit; Paths: config/mcp-portals) Update the immutable revision, source digest, artifact hashes, and vendored profiles.
- [x] PIN-2 (Owner: change owner; Depends: PIN-1; Paths: scripts) Verify the real pinned artifacts expose only the approved baseline grant.
- [x] PIN-3 (Owner: change owner; Depends: PIN-2; Paths: repository) Run focused tests and strict OpenSpec validation; commit and push are the final delivery step.
