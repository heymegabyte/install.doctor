#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TEMPLATE="$ROOT/home/dot_local/share/cargo/config.toml.tmpl"
GENERATOR="$ROOT/home/dot_local/bin/post-installx/executable_post-nexus-cache.sh"

if ! command -v cargo >/dev/null 2>&1; then
  printf 'SKIP cargo-config: cargo is unavailable\n'
  exit 0
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/install-doctor-cargo-config.XXXXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/cargo-home" "$work/crate/src"
cp "$TEMPLATE" "$work/cargo-home/config.toml"
printf '%s\n' '[package]' 'name = "config-check"' 'version = "0.0.0"' 'edition = "2021"' > "$work/crate/Cargo.toml"
printf '%s\n' 'fn main() {}' > "$work/crate/src/main.rs"

CARGO_HOME="$work/cargo-home" cargo metadata \
  --format-version 1 --no-deps --offline --manifest-path "$work/crate/Cargo.toml" >/dev/null

if grep -q '\[source\.crates-io-upstream\]' "$GENERATOR"; then
  printf 'cargo-config: generator reintroduces a duplicate crates.io source\n' >&2
  exit 1
fi

printf 'cargo-config: native parse and generator authority passed\n'
