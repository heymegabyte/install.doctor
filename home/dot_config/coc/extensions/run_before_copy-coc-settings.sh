#!/usr/bin/env bash

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}"
COC_EXT_DIR="$CONFIG_DIR/coc/extensions"

if [ ! -f "$COC_EXT_DIR/package.json" ]; then
  mkdir -p "$COC_EXT_DIR"
  if [ -f "$COC_EXT_DIR/package.master.json" ]; then
    cp -f "$COC_EXT_DIR/package.master.json" "$COC_EXT_DIR/package.json"
  else
    echo "Warning: package.master.json not found at $COC_EXT_DIR/package.master.json"
    # Create a minimal package.json as fallback
    cat > "$COC_EXT_DIR/package.json" << 'EOF'
{
  "dependencies": {},
  "lastUpdate": 0
}
EOF
  fi
fi
