#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INSTALLX="$ROOT/home/dot_local/bin/executable_installx"
P=0 F=0
pass() { printf 'PASS %s\n' "$*"; P=$((P + 1)); }
fail() { printf 'FAIL %s\n' "$*" >&2; F=$((F + 1)); }

if command -v node >/dev/null 2>&1 && node --input-type=module --check < "$INSTALLX" >/dev/null 2>&1; then
  pass 'installx parses as valid ECMAScript before provisioning'
else
  fail 'installx contains a JavaScript syntax error or Node.js is unavailable'
fi

if grep -Fq 'await (typeof task === '\''function'\'' ? task() : task)' "$INSTALLX"; then
  pass 'serial helper starts each task only when its turn is reached'
else
  fail 'serial helper only awaits already-started promises'
fi

flatpak_case="$(sed -n "/case 'flatpak':/,/break/p" "$INSTALLX")"
if printf '%s\n' "$flatpak_case" | grep -Fq 'forEachSeries' \
  && ! printf '%s\n' "$flatpak_case" | grep -Fq '.map(task => task())'; then
  pass 'flatpak installs remain lazy and serial'
else
  fail 'flatpak promises start eagerly before serial iteration'
fi

bundle_fn="$(sed -n '/async function bundleInstall/,/^}/p' "$INSTALLX")"
if printf '%s\n' "$bundle_fn" | grep -Fq 'fs.mkdtempSync' \
  && printf '%s\n' "$bundle_fn" | grep -Fq 'fs.rmSync' \
  && ! printf '%s\n' "$bundle_fn" | grep -Fq 'cd('; then
  pass 'brew bundle uses a cleaned private directory without changing global cwd'
else
  fail 'brew bundle leaks its temp directory or mutates process-global cwd'
fi

if grep -Fq "Math.min(16, Math.max(1," "$INSTALLX"; then
  pass 'install worker count is bounded to the documented safety ceiling of 16'
else
  fail 'INSTALLX_CONCURRENCY can create an unbounded number of workers'
fi

post_fn="$(sed -n '/async function postInstall/,/^}/p' "$INSTALLX")"
if printf '%s\n' "$post_fn" | grep -Fq 'postInstallFailures' \
  && printf '%s\n' "$post_fn" | grep -Fq 'throw new Error'; then
  pass 'rejected post-install work fails the owning install operation'
else
  fail 'postInstall ignores rejected work and reports false success'
fi

manager_fn="$(sed -n '/async function acquireManagerList/,/^}/p' "$INSTALLX")"
if ! printf '%s\n' "$manager_fn" | grep -Fq 'setTimeout' \
  && printf '%s\n' "$manager_fn" | grep -Fq 'await execPromise'; then
  pass 'manager inventory refresh completes before its cache is read'
else
  fail 'manager inventory reads a stale cache while refresh runs in the background'
fi

if printf '%s\n' "$manager_fn" | grep -Fq 'path.join(cacheDir, type)' \
  && ! printf '%s\n' "$manager_fn" | grep -Fq '> ${cacheDir}'; then
  pass 'manager inventory cache paths are not interpolated into a shell command'
else
  fail 'manager inventory redirects through a shell-expanded cache path'
fi

if ! grep -Fq ' $*`)' "$INSTALLX" && grep -Fq '"$@"`)' "$INSTALLX"; then
  pass 'generated application shims preserve argument boundaries'
else
  fail 'generated application shims interpolate unquoted $*'
fi

if ! grep -Eq -- '--ignore-missing|skip_if_unavailable|skip_missing_names_on_install' "$INSTALLX"; then
  pass 'system package managers cannot hide a missing selected package'
else
  fail 'installx still permits apt/dnf/yum to report success while selected packages are missing'
fi

binary_case="$(sed -n "/case 'binary':/,/break/p" "$INSTALLX")"
if printf '%s\n' "$binary_case" | grep -Fq 'binary provider is disabled' \
  && ! printf '%s\n' "$binary_case" | grep -Eq 'curl|wget'; then
  pass 'unverified binary downloads fail closed instead of executing mutable bytes'
else
  fail 'binary provider still downloads executable bytes without a digest-bound artifact contract'
fi

printf 'installx-scheduler: %d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
