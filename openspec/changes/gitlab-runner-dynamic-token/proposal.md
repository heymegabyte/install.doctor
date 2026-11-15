# Proposal: Dynamic GitLab Runner Token Acquisition

> **Architect:** codex
> **Architect Role:** assigned
> **Issue:** `install.doctor#134` / `MEG-70`

## Why

The GitHub runner used to acquire its registration token on demand: the `post-github-runner.sh` hook called the GitHub API with a stored access token, took the short-lived registration token from the response, and registered the runner non-interactively. Operators therefore never pasted a runner token into `software.yml` or a secret store.

`gitlab-runner` never got that treatment. Enrollment depended on three host-specific pre-minted registration tokens (`GITLAB_RUNNER_TOKEN_DARWIN`, `_LINUX`, `_WINDOWS`) exported by `home/dot_config/shell/private_private.sh.tmpl`. That model has four problems:

1. **Stale secrets.** GitLab registration tokens expire and rotate; a baked-in token fails silently on a host that has not been re-provisioned.
2. **Per-host sprawl.** Three variables encode host-specific channels for what is logically one grant, so adding a machine means minting and storing another token by hand.
3. **Copy-paste exposure.** Getting a token into the environment required moving it through a terminal or a chat channel — the exact flow dynamic acquisition removes.
4. **No parity.** The documented capability ("the runner joins itself") existed for GitHub but not for GitLab, so `software.yml` advertised a `gitlab-runner` package that could not actually complete enrollment unattended.

## What Changes

- Add `home/dot_local/bin/post-installx/executable_post-gitlab-runner.sh`, an idempotent hook that mints a runner authentication token from `POST {url}/api/v4/user/runners` using `GITLAB_ACCESS_TOKEN`, then registers it with `gitlab-runner register --non-interactive`. This mirrors the retired `post-github-runner.sh` contract without reintroducing its weaknesses.
- Fail closed and stay inert by default: the hook no-ops unless `INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL=1`, so no host silently joins a CI fleet.
- Keep secrets out of logs and process tables: the access token travels via a `0600` curl header file (`--header @file`), the minted runner token never reaches stdout/stderr, and the runner config is written under `umask 077` and re-chmodded `0600`.
- Add `scripts/test-gitlab-runner-post-hook.sh`, an offline contract gate (11 assertions, stubbed `curl` and `gitlab-runner`, zero network) covering the binary gate, opt-in gate, fail-closed secret resolution, scope validation, the mint-and-register happy path, token non-disclosure, config permissions, and idempotency.
- Document `GITLAB_ACCESS_TOKEN` and the enrollment knobs in `docs/customization/secrets.md` and `docs/customization/software.md`, and mark the three `GITLAB_RUNNER_TOKEN_*` secrets as legacy rather than removing them.

## Capabilities

### New Capabilities

- `gitlab-runner-enrollment`: Opt-in, idempotent, secret-safe GitLab Runner enrollment that acquires its own authentication token, requiring no pre-minted registration token in the environment.

### Modified Capabilities

- `secrets`: `GITLAB_ACCESS_TOKEN` becomes the supported enrollment credential; the `GITLAB_RUNNER_TOKEN_*` family is documented as legacy compatibility.

## Impact

- `home/dot_local/bin/post-installx/executable_post-gitlab-runner.sh` (new) — dispatches by file-name convention, so it is reachable both from the eager desired-state closure and from the command-not-found first-use path for `gitlab-runner`. No `software.yml` change is needed, and reintroducing a catalog `script:` provider would be rejected by Installx's fail-closed guard.
- `scripts/test-gitlab-runner-post-hook.sh` (new) — wired into the existing `test:scripts` tier; the shared hook contract (`scripts/test-post-installx-dispatch.sh`) already covers the new file (43 hooks, all `set -euo pipefail`, `mktemp` trap cleanup, no hardcoded dev user).
- `docs/customization/secrets.md`, `docs/customization/software.md` — operator-facing enrollment contract.
- **Not changed:** `home/dot_config/shell/private_private.sh.tmpl` keeps exporting `GITLAB_RUNNER_TOKEN` so hosts still on the legacy pre-minted flow continue to work; the dynamic path simply no longer requires it. `gitlab-runner` remains `_deprecated` in `software.yml` (GitHub CI/CD is the estate default), so nothing enrolls a GitLab runner unless an operator opts in.
