#!/usr/bin/env bash
# @file Install Doctor Markdown Extractor
# @brief Extracts markdown from various scripts included in the [Install Doctor](https://install.doctor) project
# @description
#     This script leverages [shdoc](https://github.com/reconquest/shdoc) to extract markdown from various files
#     housed in the [Install Doctor](https://install.doctor) project.

# @description Ensures shdoc is installed via Homebrew
installShdoc() {
  if ! command -v shdoc > /dev/null; then
    echo 'Installing shdoc via Homebrew' && brew install shdoc
  fi
}

# @description Ensures install.doctor repository is cloned and
cloneInstallDoctor() {
  if [ ! -d "install.doctor/.git" ]; then
    echo 'Removing install.doctor artifacts' && rm -rf "install.doctor"
    echo 'Cloning install.doctor' && git clone https://github.com/heymegabyte/install.doctor.git
  else
    cd install.doctor
    echo 'Pulling latest changes from install.doctor repository' && git pull origin master
    cd ..
  fi
}

# @description Ensures target folders are created
makeScriptFolders() {
  for FOLDER in 'docs/scripts/after' 'docs/scripts/before' 'docs/scripts/profile' 'docs/scripts/utility'; do
    mkdir -p "$FOLDER"
  done
}

# @description Copy regular markdown files from install.doctor repository `docs/` folder
copyMarkdown() {
  rsync -a --exclude="CODEOWNERS" --exclude="CODE_OF_CONDUCT.md" --exclude="ECOSYSTEM.md" --exclude="CONTRIBUTING.md" --exclude="TODO.md" --exclude="INSPIRATION.md" --exclude="logo-full.png" install.doctor/docs/ docs
}

# @description Populates the markdown files for scripts in install.doctor/home by using shdoc
populateHomeScripts() {
  find "./install.doctor/home" -type f -name "*.sh.tmpl" | while read SCRIPT; do
    echo "Creating documentation for $SCRIPT"
    TMP="$(mktemp)"
    shdoc < "$SCRIPT" | sed '/###/,$d' | sed 's/\* \[\(.*\)\]/* [`\1`]/' | sed 's/## Index/## Script Functions/' >> "$TMP"
    shdoc < "$SCRIPT" | sed '/### /,$!d' | sed 's/^### \(.*\)$/### `\1`/' >> "$TMP"
    if echo "$SCRIPT" | grep 'after_' > /dev/null; then
        MD_FILE="docs/scripts/after/$(basename "$SCRIPT").md"
        TAG=after
    elif echo "$SCRIPT" | grep 'before_' > /dev/null; then
        MD_FILE="docs/scripts/before/$(basename "$SCRIPT").md"
        TAG=before
    else
        MD_FILE="docs/scripts/profile/$(basename "$SCRIPT").md"
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
    echo "githubLocation: https://github.com/heymegabyte/install.doctor/blob/master/$(echo "$SCRIPT" | sed 's/.*\/install.doctor\///')" >> "$MD_FILE"
    echo "scriptLocation: https://github.com/heymegabyte/install.doctor/raw/master/$(echo "$SCRIPT" | sed 's/.*\/install.doctor\///')" >> "$MD_FILE"
    echo "repoLocation: $(echo "$SCRIPT" | sed 's/.*\/install.doctor\///')" >> "$MD_FILE"
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
  find "./install.doctor/scripts" -mindepth 1 -maxdepth 1 -type f -name "*.sh" | while read SCRIPT; do
    echo "Creating documentation for $SCRIPT"
    TMP="$(mktemp)"
    shdoc < "$SCRIPT" | sed '/###/,$d' | sed 's/\* \[\(.*\)\]/* [`\1`]/' | sed 's/## Index/## Script Functions/' >> "$TMP"
    shdoc < "$SCRIPT" | sed '/### /,$!d' | sed 's/^### \(.*\)$/### `\1`/' >> "$TMP"
    MD_FILE="docs/scripts/utility/$(basename "$SCRIPT").md"
    TAG=utility
    echo "---" > "$MD_FILE"
    echo "title: $(shdoc < "$SCRIPT" | head -n 1 | sed 's/\# //')" >> "$MD_FILE"
    echo "description: $(shdoc < "$SCRIPT" | sed -n '3p')" >> "$MD_FILE"
    echo "sidebar_label: $(shdoc < "$SCRIPT" | head -n 1 | sed 's/\# //')" >> "$MD_FILE"
    echo "slug: /scripts/$TAG/$(basename "$SCRIPT")" >> "$MD_FILE"
    echo "githubLocation: https://github.com/heymegabyte/install.doctor/blob/master/$(echo "$SCRIPT" | sed 's/.*\/install.doctor\///')" >> "$MD_FILE"
    echo "scriptLocation: https://github.com/heymegabyte/install.doctor/raw/master/$(echo "$SCRIPT" | sed 's/.*\/install.doctor\///')" >> "$MD_FILE"
    echo "repoLocation: $(echo "$SCRIPT" | sed 's/.*\/install.doctor\///')" >> "$MD_FILE"
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
  cd install.doctor/home/dot_config/task
  TASKS="$(task --list)"
  task --list | while read LINE; do
    TASK="$(echo "$LINE" | sed 's/\* \(.*\):[^ ]*\(.*\)/\1/')"
    echo "Processing the $TASK task"
    TASK_DESC="$(echo "$LINE" | sed 's/\* \(.*\):[^ ]*\(.*\)/\2/')"
    if ! echo "$TASK" | grep 'Available tasks for this project' > /dev/null; then
      FILE="../../../../docs/cli/commands/$(echo "$TASK" | tr ":" -).md"
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

installShdoc &
cloneInstallDoctor &
makeScriptFolders &
wait
echo 'Finished preliminary script documentation extraction tasks'
copyMarkdown &
populateHomeScripts &
populateDanglingScripts &
populateTaskfileScripts &
wait
echo 'Finished extracting markdown from scripts in install.doctor project'

