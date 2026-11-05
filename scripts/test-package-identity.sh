#!/usr/bin/env bash
# Regression gate for the root package.json de-template cleanup (repository-wide-convergence XS-02/XS-03).
#
# The root package.json is a provisioner manifest, not a published NestJS library. Its template-era
# identity fields (main/typings/files point at a nonexistent dist/; blueprint/publishConfig/nodemonConfig/
# ntl/config and the jest/eslintConfig/commitlint/release/jscpd/lint-staged/pnpm/prettier/funding/changelog
# blocks) and the devDependencies that only served those blocks are dead and must not silently reappear
# (a reintroduced `main`/`typescript@4` would re-advertise a build that no longer exists).
#
# Live fields that tooling depends on (name/repository/bugs/engines/volta/scripts.test) must remain.
# Non-vacuous: the same detector is re-run against a planted fixture and must flag a reintroduced dead
# field, proving it cannot go silently green.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/package.json"

say() { command -v gum >/dev/null 2>&1 && gum style --foreground 51 -- "$*" || printf '\033[1;36m%s\033[0m\n' "$*"; }
pass() { command -v gum >/dev/null 2>&1 && gum style --foreground 46 -- "PASS $*" || printf '\033[1;32mPASS\033[0m %s\n' "$*"; P=$((P + 1)); }
fail() { command -v gum >/dev/null 2>&1 && gum style --foreground 196 -- "FAIL $*" || printf '\033[1;31mFAIL\033[0m %s\n' "$*"; F=$((F + 1)); }
P=0; F=0

json_has() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("1" if sys.argv[2] in d else "0")' "$PKG" "$1"; }
json_devdep_has() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); dd=d.get("devDependencies",{}); print("1" if sys.argv[2] in dd else "0")' "$PKG" "$1"; }

say "package-identity de-template gate (XS-02/XS-03)"

for k in main typings files nodemonConfig blueprint ntl publishConfig config commitlint eslintConfig release jest jscpd lint-staged pnpm prettier funding changelog; do
  [ "$(json_has "$k")" = "0" ] && pass "dead field '$k' removed" || fail "dead field '$k' still present"
done

for k in "@commitlint/config-conventional" esbuild esbuild-node-externals eslint-config-strict-mode git-cz-emoji handlebars-helpers jest-preset-ts prettier prettier-config-sexy-mode semantic-release-config typescript; do
  [ "$(json_devdep_has "$k")" = "0" ] && pass "dead devDep '$k' removed" || fail "dead devDep '$k' still present"
done

for retired_file in \
  .config/commitlintrc.cjs \
  .config/nodemon.json \
  .config/nodemon.jest.json \
  .config/prettierignore \
  .config/docs/local/package-lock.json \
  .config/docs/local/yarn.lock \
  tsconfig.json; do
  if [ -e "$ROOT/$retired_file" ]; then
    fail "retired root tooling artifact remains: $retired_file"
  else
    pass "retired root tooling artifact absent: $retired_file"
  fi
done

[ "$(json_has name)" = "1" ] && pass "name present" || fail "name missing"
[ "$(json_has repository)" = "1" ] && pass "repository present" || fail "repository missing"
[ "$(json_has bugs)" = "1" ] && pass "bugs present" || fail "bugs missing"
[ "$(json_has engines)" = "1" ] && pass "engines present" || fail "engines missing"
[ "$(json_has volta)" = "1" ] && pass "volta present" || fail "volta missing"
[ "$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(d["volta"]["node"].split(".")[0])' "$PKG")" = "24" ] && pass "volta.node major 24" || fail "volta.node major != 24"
[ "$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(d["scripts"]["test"])' "$PKG")" = "task test" ] && pass "scripts.test = task test" || fail "scripts.test drifted"

detect_dead() {
  python3 - "$1" <<'PY'
import json, sys
DEAD = ["main","typings","files","nodemonConfig","blueprint","ntl","publishConfig","config","commitlint","eslintConfig","release","jest","jscpd","lint-staged","pnpm","prettier","funding","changelog"]
DEAD_DEPS = ["@commitlint/config-conventional","esbuild","esbuild-node-externals","eslint-config-strict-mode","git-cz-emoji","handlebars-helpers","jest-preset-ts","prettier","prettier-config-sexy-mode","semantic-release-config","typescript"]
d = json.load(open(sys.argv[1]))
bad = [k for k in DEAD if k in d]
bad += ["devDep:" + k for k in DEAD_DEPS if k in d.get("devDependencies", {})]
if bad:
    print("dead:", ", ".join(bad))
    sys.exit(1)
sys.exit(0)
PY
}

detect_dead "$PKG" && pass "real package.json clean of dead fields" || fail "real package.json still has dead fields"

TMP="$(mktemp)"
printf '{"name":"x","main":"dist/main.js","devDependencies":{"typescript":"4.5.5"}}' > "$TMP"
if detect_dead "$TMP"; then
  fail "non-vacuity: detector missed a reintroduced dead field"
else
  pass "non-vacuity: detector flags a reintroduced dead field"
fi
rm -f "$TMP"

say "package-identity: $P passed, $F failed"
[ "$F" -eq 0 ]
