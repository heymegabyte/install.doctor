# Tasks: Dynamic GitLab Runner Token Acquisition

> **Issue:** `install.doctor#134` / `MEG-70`
> **Gate:** `bash scripts/test-gitlab-runner-post-hook.sh` (offline, 11 assertions)

## 1. Hook implementation

- [x] 1.1 Add `home/dot_local/bin/post-installx/executable_post-gitlab-runner.sh` addressed by file name (`post-<software.yml key>.sh`), with `set -euo pipefail` and the `_TEMPLATE.sh` post-installx contract.
- [x] 1.2 Gate the hook before any network call: platform (`Linux`/`Darwin`), binary presence (`gitlab-runner` on `PATH`), explicit opt-in (`INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL=1`). Make every gate a clean skip (`0`), never a failure.
- [x] 1.3 Resolve `GITLAB_ACCESS_TOKEN` from env → `get-secret` → age-encrypted chezmoi secret, and fail closed with exit `20` when none resolves.
- [x] 1.4 Validate `GITLAB_RUNNER_SCOPE` ∈ {`instance`,`group`,`project`}, the numeric group/project id for the chosen scope, `GITLAB_RUNNER_EXECUTOR` ∈ {`docker`,`shell`,`virtualbox`,`kubernetes`}, and the `virtualbox` base VM — all exit `2` before the API call.
- [x] 1.5 Mint via `POST {url}/api/v4/user/runners` with `runner_type=<scope>_type`, `description`, optional `tag_list`, and the scope id; parse the token with `jq`, falling back to a `sed` extraction on hosts without `jq`.
- [x] 1.6 Register non-interactively (`gitlab-runner register --non-interactive --token … --executor …`) and verify (`gitlab-runner verify`), with distinct exit codes `21`–`25` for each failure mode.
- [x] 1.7 Contain secrets: `0600` curl header file (`--header @file`), `umask 077`, config re-`chmod 0600`, `register`/`verify` output suppressed, and a single `trap cleanup EXIT HUP INT TERM` that clears token variables and removes the temp dir.
- [x] 1.8 Make the hook idempotent by registered runner *name*: an existing `name = "<runner>"` in the config short-circuits with `0` and no API call.

## 2. Offline contract gate

- [x] 2.1 Add `scripts/test-gitlab-runner-post-hook.sh` (auto-discovered by `scripts/test-all.sh`) with stub `curl` and `gitlab-runner` binaries and zero network access.
- [x] 2.2 Assert B1 binary gate, B2 opt-in gate, B3 fail-closed secret resolution with no API call, B4a/B4b scope and group-id validation before the API call.
- [x] 2.3 Assert B5a–B5e: successful mint+register, correct `POST /api/v4/user/runners` body (`group_type`, `group_id`, `tag_list`), non-interactive register with the minted token, no token in stdout/stderr, config `0600`.
- [x] 2.4 Assert B6 idempotency: a second run makes no API call and no re-registration.

## 3. Documentation

- [x] 3.1 Document `GITLAB_ACCESS_TOKEN` (and the required `create_runner` / `api` grants) in `docs/customization/secrets.md`.
- [x] 3.2 Mark `GITLAB_RUNNER_TOKEN_DARWIN|LINUX|WINDOWS` as legacy in `docs/customization/secrets.md` instead of removing them, so hosts mid-migration keep working.
- [x] 3.3 Add the enrollment section and full variable table to `docs/customization/software.md`, including the secret-containment guarantees and the contract-gate reference.
- [x] 3.4 Keep `home/dot_config/shell/private_private.sh.tmpl` exporting `GITLAB_RUNNER_TOKEN` and leave `gitlab-runner` `_deprecated` in `software.yml`, so enrollment stays opt-in.

## 4. Verification

- [x] 4.1 `bash scripts/test-gitlab-runner-post-hook.sh` → 11 passed, 0 failed.
- [x] 4.2 `bash scripts/test-post-installx-dispatch.sh` → the new hook satisfies every shared contract (naming, fail-fast, `mktemp` trap, no hardcoded dev user).
- [x] 4.3 `bash scripts/test-shellcheck-quality.sh` → `shellcheck -S error` clean across all post-installx hooks.
- [x] 4.4 `openspec validate gitlab-runner-dynamic-token --strict` → clean.
- [x] 4.5 `bash scripts/test-all.sh` → full suite green.
- [x] 4.6 Commit, push, open a PR against `main`, merge, and confirm the merge commit is on `origin/main`.
