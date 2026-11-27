#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/bin"
printf '%s\n' '#!/usr/bin/env sh' 'printf "%s\\n" fixture-weather-key' >"$fixture/bin/get-secret"
chmod 0700 "$fixture/bin/get-secret"

rendered_key="$({
  PATH="$fixture/bin:$PATH" OPENWEATHERMAP_API_KEY=fixture-weather-key \
    chezmoi execute-template <"$repo_root/home/dot_config/wego/private_wegorc.tmpl"
} | awk -F= '$1 == "owm-api-key" { print substr($0, index($0, "=") + 1); exit }')"

test "$rendered_key" = fixture-weather-key
printf '%s\n' 'wego-infisical-secret: PASS'
