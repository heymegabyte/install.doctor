## Tasks

- [x] Record the deployed source drift and reproduce its outage behavior in an isolated fixture.
- [ ] Define and generate a release identity shared by the standalone proxy and generated provisioning hook.
- [x] Extend the workstation doctor to compare selected, installed, and running identities.
- [ ] Implement targeted local reconciliation and rollback using the existing service managers.
- [ ] Verify clean, drifted, needs-restart, rollback, and outage cases with isolated fixtures before rollout.

## Evidence

- At Install Doctor `e4fafa33`, the workstation doctor accepts HTTP 200 with a `node-typescript` runtime. The running loopback `/healthz` returned those values and supplied no source digest.
- The canonical standalone source at `b181341fd1bbcc961cdfee3ddc8882484f8f299b` has SHA-256 `f204fdca6c1d4f1918f1c9857b091068517d1adf000d6b1e7f529c2289fec429`, also observed at `e4fafa33`. The running agent's installed source had SHA-256 `654f356db77c099b6c72914571aeeb127e5ff536a1aef0c7e337efcfa475d614` and mode 0755. Its file modification time preceded the running process start.
- The exact canonical outage suite passed. A synthetic cold-miss run using the installed bytes sent first-party-style requests to its mock public upstream. Applying only the canonical first-party guard diff to copied deployed bytes produced SHA-256 `f7a15015dbbfa1b02a7822f7519d506e0bb07410a597b4a41664735285a20fa6` and passed the full outage fixture with Node 22.23.5 and the LaunchAgent's Node 26.13.1.
- On the observed Mac, `space.megabyte.local-proxy` was listening on `127.0.0.1:4880`. `/healthz` returned HTTP 200 with `LOCAL-HEALTHZ`. `/repository/npm-group/zod` returned HTTP 200. The public registry and Nexus hostnames use separate edge-to-origin routing from the workstation service.
- The complete canonical source also adds local CAS operations and a vulnerable-package denylist. Any approval of a guard-only local rollout must bind its exact digest and preserve this distinction in the deployment receipt.
- The current workstation's one-file chezmoi source lookup reported inconsistent source state. The documented bootstrap hook also rewrites package-manager configuration, so a focused reconciliation needs its own exact staged-artifact path. The fixture command is `node --test scripts/test-local-proxy-outage.mjs` in an isolated source tree.

- The workstation doctor obtains the configured source directory from `chezmoi source-path` and hashes the selected standalone file and installed bytes separately. It accepts a valid running digest when a healthy proxy supplies it. Missing evidence and digest mismatches appear as an independent warning and fail `--strict`. The running digest producer remains pending.
