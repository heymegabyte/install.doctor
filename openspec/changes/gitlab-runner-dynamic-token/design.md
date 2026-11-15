# Design: Dynamic GitLab Runner Token Acquisition

> **Architect:** codex
> **Architect Role:** assigned
> **Issue:** `install.doctor#134` / `MEG-70`

## Context

`post-installx` hooks are the only sanctioned place for package configuration logic (`docs/customization/software.md` § Typed configuration hooks: "Do not define shell scripts in YAML"). A hook is addressed purely by file name — `home/dot_local/bin/post-installx/executable_post-<key>.sh` installs to `~/.local/bin/post-installx/post-<key>.sh` — and has two dispatch paths:

1. **Eager closure.** `runPostInstallxHooks` in `home/.chezmoiscripts/universal/run_after_20-post-install.sh.tmpl` selects packages where `_default != false and (_preload == true or _serviceEnabled == true)`.
2. **First use.** `home/dot_config/shell/not-found-hook.sh` dispatches `post-<cmd>.sh` after an explicit command-not-found install.

`gitlab-runner` matches neither selection predicate (it carries `_deprecated` and no `_preload`/`_serviceEnabled`), so the hook is inert during provisioning and runs only on deliberate first use. That is the desired posture: enrollment is an operator decision, not a side effect of having the binary installed.

The reference implementation, `executable_post-github-runner.sh`, was deleted in `07d599f2` ("refactor(installer): remove duplicate runner enrollment") because a second enrollment path existed. Its contract is still the target behaviour: mint a registration token from the provider API with a long-lived access token, then register non-interactively.

## Decisions

### 1. Hook, not `software.yml` `_post` metadata

The GitHub hook the issue refers to as "the `_post` script in `software.yml`" was in fact a `post-installx` hook; the catalog `script:`/`_post:` mechanism has since been removed, and `executable_installx` fails closed on any reintroduced catalog script provider (`scripts/test-post-installx-dispatch.sh` assertion A2). Implementing the request as a file-name-addressed hook is therefore the only path that stays valid — and it needs no `software.yml` edit at all.

### 2. Mint with `POST /api/v4/user/runners`, never the deprecated registration endpoint

GitLab retired `POST /api/v4/runners` (the legacy registration-token flow) for new runners. The supported mint is `POST /api/v4/user/runners` with `runner_type` ∈ {`instance_type`, `group_type`, `project_type`}, authenticated by an access token carrying `create_runner`. The hook derives `runner_type` directly from `GITLAB_RUNNER_SCOPE`, so a single `SCOPE` knob cannot drift out of sync with the request body.

### 3. Fail closed, and inert by default

Three gates run before any network call: platform (`Linux`/`Darwin` only), binary presence (`gitlab-runner` on `PATH`), and explicit opt-in (`INSTALL_DOCTOR_GITLAB_RUNNER_ENROLL=1`). A missing `GITLAB_ACCESS_TOKEN` exits `20` without calling the API. Every failure has a distinct exit code so provisioning logs identify the cause without echoing secrets:

| Exit | Meaning |
| --- | --- |
| `0` | Enrolled, or skipped by a gate / already registered |
| `2` | Invalid configuration (scope, id, executor, base VM) — no API call made |
| `20` | No resolvable `GITLAB_ACCESS_TOKEN` — no API call made |
| `21` | GitLab rejected the mint request (`create_runner` missing or scope insufficient) |
| `22` | Mint succeeded but returned no token |
| `23` | `gitlab-runner register` failed (output suppressed) |
| `24` | Registered, but `gitlab-runner verify` failed |
| `25` | `curl` unavailable |

### 4. Secret containment beats ergonomics

- The access token is written once to `$TMPDIR/curl-headers` at `0600` and passed as `--header @file`, so it never appears in `argv`, the process list, or `ps` output.
- The minted runner token is read from a file into a variable and handed to `gitlab-runner register --token` as a single non-interpolated `argv` element — never through `bash -c`, a shell string, or a log line. `register`/`verify` output is redirected to a temp file and discarded on failure.
- `umask 077` plus an explicit `chmod 0600` on the runner config keeps credentials out of group/other reach.
- One `trap cleanup EXIT HUP INT TERM` clears both token variables and removes the temp directory, satisfying `_TEMPLATE.sh` requirement 5 and `scripts/test-post-installx-dispatch.sh`'s `mktemp`-trap assertion.

### 5. Idempotency by registered name

Before minting, the hook greps the runner config for `name = "<runner-name>"`. A name already present short-circuits with exit `0`, so repeated provisioning never mints a duplicate runner or burns an API call. Matching on the runner *name* (operator-chosen and stable) rather than a token is deliberate: tokens rotate, names do not.

### 6. Legacy credentials documented, not deleted

`home/dot_config/shell/private_private.sh.tmpl` still exports `GITLAB_RUNNER_TOKEN`. Removing the export would break any host mid-migration with no compensating benefit — the variable is inert unless a legacy `gitlab-runner register` flow reads it. The documentation marks the `GITLAB_RUNNER_TOKEN_*` family as legacy and points to `GITLAB_ACCESS_TOKEN`.

## Risks

| Risk | Mitigation |
| --- | --- |
| A host enrolls into the wrong GitLab group/instance | Scope and numeric ids are validated before the API call; enrollment requires an explicit opt-in env var, so a stray `gitlab-runner` binary cannot self-enroll |
| Access token over-privileged | Docs specify the minimum grant (`create_runner`, plus `api` only for group/project scope) |
| Token leaks through provisioning logs | Header-file transport, suppressed `register` output, and contract assertion `B5d` asserting the minted token never reaches stdout/stderr |
| GitLab API changes break the mint | Failure is contained to exit `21`/`22` with an actionable message; the hook never touches an existing config on failure |
| Divergent copy of the hook in another repo | The hook is generic (no estate-specific ids); reuse should import from `install.doctor` rather than fork |

## Verification

- `bash scripts/test-gitlab-runner-post-hook.sh` — 11 assertions, stubbed `curl`/`gitlab-runner`, no network.
- `bash scripts/test-post-installx-dispatch.sh` — shared hook contract (fail-fast, `mktemp` trap, naming, no hardcoded dev user).
- `bash scripts/test-shellcheck-quality.sh` — `shellcheck -S error` clean across all hooks.
