#!/usr/bin/env bash
# @file Install Doctor Markdown Extractor
# @brief Extracts markdown from various scripts included in the [Install Doctor](https://install.doctor) project
# @description
#     This script leverages [shdoc](https://github.com/reconquest/shdoc) to extract markdown from various files
#     housed in the [Install Doctor](https://install.doctor) project.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCS_SITE_ROOT="${DOCS_SITE_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
INSTALL_DOCTOR_ROOT="${INSTALL_DOCTOR_ROOT:-$(cd "$DOCS_SITE_ROOT/../.." && pwd)}"

if [ ! -f "$INSTALL_DOCTOR_ROOT/software.yml" ] || [ ! -d "$INSTALL_DOCTOR_ROOT/docs" ]; then
  printf 'Unable to locate the Install Doctor source tree at %s\n' "$INSTALL_DOCTOR_ROOT" >&2
  exit 1
fi

# @description Verifies explicit build dependencies without mutating the host
requireGeneratorTools() {
  local missing=()
  for tool in rsync shdoc task; do
    command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
  done
  if ((${#missing[@]})); then
    printf 'Missing documentation generator tool(s): %s\n' "${missing[*]}" >&2
    exit 69
  fi
}

# @description Removes stale generated text while preserving image assets
cleanGeneratedMarkdown() {
  [ -d "$DOCS_SITE_ROOT/docs" ] || return 0
  find "$DOCS_SITE_ROOT/docs" -type f \
    ! -iname '*.png' ! -iname '*.jpg' ! -iname '*.jpeg' ! -iname '*.gif' \
    ! -iname '*.webp' ! -iname '*.svg' ! -iname '*.ico' ! -iname '*.avif' \
    -delete
}

# @description Ensures target folders are created
makeScriptFolders() {
  for FOLDER in 'docs/scripts/after' 'docs/scripts/before' 'docs/scripts/profile' 'docs/scripts/utility'; do
    mkdir -p "$DOCS_SITE_ROOT/$FOLDER"
  done
}

# @description Copy regular markdown files from install.doctor repository `docs/` folder
copyMarkdown() {
  rsync -a --exclude="CODEOWNERS" --exclude="CODE_OF_CONDUCT.md" --exclude="ECOSYSTEM.md" --exclude="CONTRIBUTING.md" --exclude="TODO.md" --exclude="INSPIRATION.md" --exclude="logo-full.png" "$INSTALL_DOCTOR_ROOT/docs/" "$DOCS_SITE_ROOT/docs"
}

# @description Populates the markdown files for scripts in install.doctor/home by using shdoc
populateHomeScripts() {
  find "$INSTALL_DOCTOR_ROOT/home" -type f -name "*.sh.tmpl" | while read SCRIPT; do
    echo "Creating documentation for $SCRIPT"
    TMP="$(mktemp)"
    shdoc < "$SCRIPT" | sed '/###/,$d' | sed 's/\* \[\(.*\)\]/* [`\1`]/' | sed 's/## Index/## Script Functions/' >> "$TMP"
    shdoc < "$SCRIPT" | sed '/### /,$!d' | sed 's/^### \(.*\)$/### `\1`/' >> "$TMP"
    if echo "$SCRIPT" | grep 'after_' > /dev/null; then
        MD_FILE="$DOCS_SITE_ROOT/docs/scripts/after/$(basename "$SCRIPT").md"
        TAG=after
    elif echo "$SCRIPT" | grep 'before_' > /dev/null; then
        MD_FILE="$DOCS_SITE_ROOT/docs/scripts/before/$(basename "$SCRIPT").md"
        TAG=before
    else
        MD_FILE="$DOCS_SITE_ROOT/docs/scripts/profile/$(basename "$SCRIPT").md"
        TAG=profile
    fi
    NUMBER_ID_PREFIX=""
    if echo "$SCRIPT" | grep '[0-9][0-9]' > /dev/null; then
        NUMBER_ID_PREFIX="$(echo "$SCRIPT" | sed 's/.*\([0-9][0-9]\).*/\1/') "
    fi
    echo "---" > "$MD_FILE"
    echo "title: $(shdoc < "$SCRIPT" | head -n 1 | sed 's/\# //')" >> "$MD_FILE"
    echo "description: $(shdoc < "$SCRIPT" | sed -n '3p')" >> "$MD_FILE"
    echo "sidebar_label: $NUMBER_ID_PREFIX$(shdoc < "$SCRIPT" | head -n 1 | sed 's/\# //')" >> "$MD_FILE"
    echo "slug: /scripts/$TAG/$(basename "$SCRIPT")" >> "$MD_FILE"
    REPO_PATH="${SCRIPT#"$INSTALL_DOCTOR_ROOT/"}"
    echo "githubLocation: https://github.com/heymegabyte/install.doctor/blob/master/$REPO_PATH" >> "$MD_FILE"
    echo "scriptLocation: https://github.com/heymegabyte/install.doctor/raw/master/$REPO_PATH" >> "$MD_FILE"
    echo "repoLocation: $REPO_PATH" >> "$MD_FILE"
    echo "---" >> "$MD_FILE"
    cat "$TMP" >> "$MD_FILE"
    echo "## Source Code" >> "$MD_FILE"
    echo "" >> "$MD_FILE"
    echo '```shell' >> "$MD_FILE"
    cat "$SCRIPT" >> "$MD_FILE"
    echo '```' >> "$MD_FILE"
  done
}

# @description Populates the markdown files for the scripts in install.doctor/scripts using shdoc
populateDanglingScripts() {
  find "$INSTALL_DOCTOR_ROOT/scripts" -mindepth 1 -maxdepth 1 -type f -name "*.sh" | while read SCRIPT; do
    echo "Creating documentation for $SCRIPT"
    TMP="$(mktemp)"
    shdoc < "$SCRIPT" | sed '/###/,$d' | sed 's/\* \[\(.*\)\]/* [`\1`]/' | sed 's/## Index/## Script Functions/' >> "$TMP"
    shdoc < "$SCRIPT" | sed '/### /,$!d' | sed 's/^### \(.*\)$/### `\1`/' >> "$TMP"
    MD_FILE="$DOCS_SITE_ROOT/docs/scripts/utility/$(basename "$SCRIPT").md"
    TAG=utility
    echo "---" > "$MD_FILE"
    echo "title: $(shdoc < "$SCRIPT" | head -n 1 | sed 's/\# //')" >> "$MD_FILE"
    echo "description: $(shdoc < "$SCRIPT" | sed -n '3p')" >> "$MD_FILE"
    echo "sidebar_label: $(shdoc < "$SCRIPT" | head -n 1 | sed 's/\# //')" >> "$MD_FILE"
    echo "slug: /scripts/$TAG/$(basename "$SCRIPT")" >> "$MD_FILE"
    REPO_PATH="${SCRIPT#"$INSTALL_DOCTOR_ROOT/"}"
    echo "githubLocation: https://github.com/heymegabyte/install.doctor/blob/master/$REPO_PATH" >> "$MD_FILE"
    echo "scriptLocation: https://github.com/heymegabyte/install.doctor/raw/master/$REPO_PATH" >> "$MD_FILE"
    echo "repoLocation: $REPO_PATH" >> "$MD_FILE"
    echo "---" >> "$MD_FILE"
    cat "$TMP" >> "$MD_FILE"
    echo "## Source Code" >> "$MD_FILE"
    echo "" >> "$MD_FILE"
    echo '```shell' >> "$MD_FILE"
    cat "$SCRIPT" >> "$MD_FILE"
    echo '```' >> "$MD_FILE"
  done
}

# @description Populates Taskfile.yml markdown files using shdoc
populateTaskfileScripts() {
  cd "$INSTALL_DOCTOR_ROOT/home/dot_config/task"
  TASKS="$(task --list)"
  task --list | while read LINE; do
    TASK="$(echo "$LINE" | sed 's/\* \(.*\):[^ ]*\(.*\)/\1/')"
    echo "Processing the $TASK task"
    TASK_DESC="$(echo "$LINE" | sed 's/\* \(.*\):[^ ]*\(.*\)/\2/')"
    if ! echo "$TASK" | grep 'Available tasks for this project' > /dev/null; then
      FILE="$DOCS_SITE_ROOT/docs/cli/commands/$(echo "$TASK" | tr ":" -).md"
      mkdir -p "$(dirname "$FILE")"
      SUMMARY="$(task --summary "$TASK")"
      LINE_NUMBER="$(awk '/  '"$TASK"':/{ print NR; exit }' Taskfile.yml)"
      echo "---" > "$FILE"
      echo "title: "$(echo "$SUMMARY" | sed -n '3p' | sed 's/\# //')"" >> "$FILE"
      echo "description: $TASK_DESC" >>"$FILE"
      echo "sidebar_label: $TASK" >> "$FILE"
      echo "slug: /cli/commands/$(echo "$TASK" | tr ":" -)" >> "$FILE"
      echo "githubLocation: https://github.com/heymegabyte/install.doctor/blob/master/home/dot_config/task/Taskfile.yml#L$LINE_NUMBER" >> "$FILE"
      echo "repoLocation: home/dot_config/task/Taskfile.yml" >> "$FILE"
      echo "---" >> "$FILE"
      TMP="$(mktemp)"
      echo "$SUMMARY" > "$TMP"
      TRIMMED_TMP="$(mktemp)"
      cat "$TMP" | tail -n +5 > "$TRIMMED_TMP"
      SED_EXE="$(which sed)"
      if [ -d /Applications ] && [ -d /System ]; then
        if ! command -v gsed > /dev/null; then
          brew install gsed
        fi
        SED_EXE="$(which gsed)"
      fi
      $SED_EXE '/commands:/Q' < "$TRIMMED_TMP" >> "$FILE"
      echo "Processed taskfile-based markdown rendering for $FILE"
    fi
  done
}

# Copy-only mode is used by hermetic tests and documentation packaging jobs
# that do not need shdoc or Task installed.
if [ "${MARKDOWN_COPY_ONLY:-0}" = "1" ]; then
  cleanGeneratedMarkdown
  makeScriptFolders
  copyMarkdown
  exit 0
fi

requireGeneratorTools
cleanGeneratedMarkdown
makeScriptFolders
echo 'Finished preliminary script documentation extraction tasks'
copyMarkdown
populateHomeScripts
populateDanglingScripts
populateTaskfileScripts
echo 'Finished extracting markdown from scripts in install.doctor project'
