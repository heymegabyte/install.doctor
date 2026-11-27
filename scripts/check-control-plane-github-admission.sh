#!/usr/bin/env bash
set -euo pipefail

expected_branch=${1:-main}
case "$expected_branch" in
  main|master) ;;
  *) printf 'Usage: %s [main|master]\n' "$0" >&2; exit 2 ;;
esac

environment_path=repos/heymegabyte/install.doctor/environments/control-plane-production
environment=$(gh api --method GET "$environment_path")
branch_pages=$(gh api --method GET --paginate --slurp "$environment_path/deployment-branch-policies")

if ! jq -e '
  .name == "control-plane-production" and
  .deployment_branch_policy == {custom_branch_policies: true, protected_branches: false} and
  ([.protection_rules[] | select(.type == "required_reviewers")] |
    length == 1 and .[0].prevent_self_review == true and (.[0].reviewers | length > 0))
' <<<"$environment" >/dev/null; then
  printf 'GitHub environment must require reviewers, prevent self-review, and use custom branch policies.\n' >&2
  exit 1
fi

if ! jq -e --arg branch "$expected_branch" '
  length > 0 and all(.[]; (.branch_policies | type) == "array") and
  ([.[].branch_policies[] | {name, type}] == [{name: $branch, type: "branch"}])
' <<<"$branch_pages" >/dev/null; then
  printf 'GitHub environment must admit exactly the %s branch.\n' "$expected_branch" >&2
  exit 1
fi

printf 'GitHub admission allows only %s and requires an independent reviewer.\n' "$expected_branch"
