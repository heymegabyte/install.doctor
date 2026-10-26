#!/usr/bin/env bash
# Build the command-not-found lookup index from install.doctor software.yml.
# TSV: bin  key  brew apt dnf pacman cask choco scoop go cargo npm pipx pip gem
# (array installer values are space-joined; a multi-binary _bin yields one row per binary).
# Primary path: yq (YAML→JSON) | jq (robust array handling). Fallback: python3 + pyyaml.
# Run at provisioning time + whenever software.yml changes.
set -euo pipefail
SRC="${1:-$HOME/.local/share/chezmoi/software.yml}"
OUT="${2:-$HOME/.cache/cnf/index.tsv}"
mkdir -p "$(dirname "$OUT")"
[ -f "$SRC" ] || { echo "software.yml not found at $SRC" >&2; exit 1; }

JQ='to_entries[] | . as $e | $e.value as $v |
  (([$v.brew,$v.apt,$v.dnf,$v.pacman,$v.cask,$v.choco,$v.scoop,$v.go,$v.cargo,$v.npm,$v.pipx,$v.pip,$v.gem]
    | map(if . == null then "" elif type=="array" then (map(tostring)|join(" ")) else tostring end))) as $cols |
  (($v["_bin"] // $e.key) | if type=="array" then . else [.] end) as $bins |
  $bins[] | [ (tostring), $e.key ] + $cols | @tsv'

if command -v yq >/dev/null 2>&1 && command -v jq >/dev/null 2>&1; then
  yq -o=json '.softwarePackages' "$SRC" | jq -r "$JQ" > "$OUT"
elif python3 -c 'import yaml' 2>/dev/null; then
  python3 - "$SRC" "$OUT" <<'PY'
import sys, yaml
src, out = sys.argv[1], sys.argv[2]
pk = (yaml.safe_load(open(src)) or {}).get("softwarePackages", {})
cols = ["brew","apt","dnf","pacman","cask","choco","scoop","go","cargo","npm","pipx","pip","gem"]
def f(x): return " ".join(map(str, x)) if isinstance(x, list) else (str(x) if x not in (None, "", False) else "")
with open(out, "w") as fh:
    for k, v in pk.items():
        if not isinstance(v, dict): continue
        b = v.get("_bin") or k
        bins = b if isinstance(b, list) else [b]
        c = [f(v.get(col)) for col in cols]
        for bn in bins:
            if isinstance(bn, str): fh.write("\t".join([bn, k] + c) + "\n")
PY
else
  echo "need (yq + jq) or python3+pyyaml to parse software.yml" >&2; exit 1
fi
echo "cnf index: $(wc -l < "$OUT" | tr -d ' ') binaries -> $OUT"
