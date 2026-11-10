#!/usr/bin/env bash
# Reconcile an authenticated Ollama origin into an existing LiteLLM model catalog.
#
# This is an internal development/fleet integration. It intentionally does not wire
# LiteLLM into the customer-facing aid runtime.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: reconcile-litellm-ollama-fleet.sh CONFIG --api-base URL --rpm NUMBER [--template-model MODEL]

Adds one deployment per model alias that already has an exact template
(default: ollama_chat/qwen2.5:7b-instruct). Prints the number added.
EOF
}

die() {
  printf 'reconcile-litellm-ollama-fleet: %s\n' "$*" >&2
  exit 2
}

[ "$#" -ge 1 ] || { usage; exit 2; }
config=$1
shift
api_base=
rpm=
template_model=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --api-base)
      [ -z "$api_base" ] || die '--api-base may be specified only once'
      [ "$#" -ge 2 ] || die '--api-base requires a value'
      api_base=$2
      shift 2
      ;;
    --rpm)
      [ -z "$rpm" ] || die '--rpm may be specified only once'
      [ "$#" -ge 2 ] || die '--rpm requires a value'
      rpm=$2
      shift 2
      ;;
    --template-model)
      [ -z "$template_model" ] || die '--template-model may be specified only once'
      [ "$#" -ge 2 ] || die '--template-model requires a value'
      template_model=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$template_model" ] || template_model="ollama_chat/qwen2.5:7b-instruct"

[ -n "$api_base" ] || die '--api-base is required'
[ -n "$rpm" ] || die '--rpm is required'
[ -f "$config" ] || die "config is not a regular file: $config"
[ ! -L "$config" ] || die 'refusing to replace a symbolic-link config'
command -v python3 >/dev/null 2>&1 || die 'python3 is required'
python3 -c 'import yaml' >/dev/null 2>&1 || die 'the Python yaml module is required'

case "$rpm" in
  ''|*[!0-9]*) die '--rpm must be an integer from 1 through 10000' ;;
esac
[ "$rpm" -ge 1 ] && [ "$rpm" -le 10000 ] || die '--rpm must be an integer from 1 through 10000'

# Remote origins must use TLS. Plain HTTP is accepted only for loopback, which
# retains support for a locally bound Ollama daemon without weakening fleet links.
case "$api_base" in
  https://?*|http://localhost:*|http://127.0.0.1:*|http://\[::1\]:*) ;;
  *) die '--api-base must be an https URL or an explicit HTTP loopback URL' ;;
esac
case "$api_base" in
  *[[:space:]]*|*'#'*|*'?'*) die '--api-base contains unsupported URL characters' ;;
esac

python3 - "$config" "$api_base" "$rpm" "$template_model" <<'PY'
import copy
import os
import re
import stat
import sys
import tempfile
from urllib.parse import urlparse

import yaml

path, api_base, rpm_text, template_model = sys.argv[1:]
rpm = int(rpm_text)
host_part = urlparse(api_base).hostname or api_base
origin_slug = re.sub(r"[^a-z0-9]+", "-", host_part.lower()).strip("-") or "node"

try:
    with open(path, "r", encoding="utf-8") as stream:
        document = yaml.safe_load(stream)
except (OSError, UnicodeError, yaml.YAMLError) as error:
    raise SystemExit(f"reconcile-litellm-ollama-fleet: cannot read valid YAML: {error}")

if not isinstance(document, dict):
    raise SystemExit("reconcile-litellm-ollama-fleet: YAML root must be a mapping")
models = document.get("model_list")
if not isinstance(models, list):
    raise SystemExit("reconcile-litellm-ollama-fleet: model_list must be a list")

templates = {}
enrolled_aliases = set()
for index, entry in enumerate(models):
    if not isinstance(entry, dict):
        raise SystemExit(f"reconcile-litellm-ollama-fleet: model_list[{index}] must be a mapping")
    alias = entry.get("model_name")
    params = entry.get("litellm_params")
    if not isinstance(alias, str) or not alias.strip():
        raise SystemExit(f"reconcile-litellm-ollama-fleet: model_list[{index}].model_name must be a non-empty string")
    if not isinstance(params, dict):
        raise SystemExit(f"reconcile-litellm-ollama-fleet: model_list[{index}].litellm_params must be a mapping")
    if params.get("api_base") == api_base:
        enrolled_aliases.add(alias)
    if params.get("model") == template_model and alias not in templates:
        templates[alias] = entry

additions = []
for alias, template in templates.items():
    if alias in enrolled_aliases:
        continue
    deployment = copy.deepcopy(template)
    deployment["model_name"] = alias
    params = deployment["litellm_params"]
    params["model"] = template_model
    params["api_base"] = api_base
    params["api_key"] = "os.environ/OLLAMA_GATEWAY_TOKEN"
    params["rpm"] = rpm
    params.setdefault("input_cost_per_token", 0.0)
    params.setdefault("output_cost_per_token", 0.0)
    params["max_parallel_requests"] = 4 if "macbook" in api_base.lower() else 8
    model_info = deployment.setdefault("model_info", {})
    if isinstance(model_info, dict):
        if model_info.get("mode") == "embedding":
            params.setdefault("timeout", 45)
        else:
            params.setdefault("timeout", 180)
            params.setdefault("stream_timeout", 45)
            if "qwen2.5" in template_model:
                params.setdefault("num_ctx", 32768)
        if "id" in model_info:
            model_info["id"] = f"{alias}-{origin_slug}"
        model_info.setdefault("tags", ["local", "ollama", "gpu"])
        model_info.pop("description", None)
    additions.append(deployment)

if not additions:
    print(0)
    raise SystemExit(0)

models.extend(additions)
directory = os.path.dirname(os.path.abspath(path))
mode = stat.S_IMODE(os.stat(path, follow_symlinks=False).st_mode)
temporary_path = ""
try:
    descriptor, temporary_path = tempfile.mkstemp(prefix=".litellm-reconcile-", suffix=".yaml", dir=directory)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        yaml.safe_dump(document, stream, sort_keys=False, allow_unicode=True)
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(temporary_path, mode)
    os.replace(temporary_path, path)
    temporary_path = ""
    directory_descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(directory_descriptor)
    finally:
        os.close(directory_descriptor)
finally:
    if temporary_path:
        try:
            os.unlink(temporary_path)
        except FileNotFoundError:
            pass

print(len(additions))
PY
