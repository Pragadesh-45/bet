#!/usr/bin/env bash
set -euo pipefail

# bet CLI - install multiple Bruno versions
# Usage:
#   bet install <version> [<version> ...]
#
# Example:
#   bet install 2.15.0 2.14.0

COMMAND=${1:-""}
shift || true

usage() {
  cat <<EOF
Usage: $(basename "$0") install <version> [<version> ...]
Example: $(basename "$0") install 2.15.0 2.14.0
EOF
  exit 1
}

if [[ "$COMMAND" != "install" ]]; then
  usage
fi

if [[ $# -lt 1 ]]; then
  echo "Please provide at least one version (e.g. 2.15.0)."
  exit 1
fi

### Detect Architecture ###
ARCH_UNAME="$(uname -m)"
case "$ARCH_UNAME" in
  x86_64) BRUNO_ARCH="x64" ;;
  arm64|aarch64) BRUNO_ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH_UNAME"
    exit 1
    ;;
esac

### Tools ###
if ! command -v curl >/dev/null 2>&1; then
  echo "curl not found. Install curl and retry."
  exit 1
fi
if ! command -v unzip >/dev/null 2>&1; then
  echo "unzip not found. Install unzip and retry."
  exit 1
fi

### Target Directory ###
TARGET_DIR="$HOME/Downloads/bet-temp/bruno-versions"
mkdir -p "$TARGET_DIR"

install_version() {
  local VERSION="$1"

  echo
  echo "======================================================"
  echo "Installing Bruno v${VERSION}"
  echo "Architecture: ${BRUNO_ARCH}"
  echo "Target dir: ${TARGET_DIR}"
  echo "------------------------------------------------------"

  local FILENAME="bruno_${VERSION}_${BRUNO_ARCH}_mac.zip"
  local URL="https://github.com/usebruno/bruno/releases/download/v${VERSION}/${FILENAME}"
  local ZIP_PATH="${TARGET_DIR}/${FILENAME}"
  local VERSIONED_APP_PATH="${TARGET_DIR}/Bruno-${VERSION}.app"

  # If version already exists, skip download/extract but open it
  if [[ -d "$VERSIONED_APP_PATH" ]]; then
    echo "Bruno-${VERSION}.app already exists at:"
    echo "  $VERSIONED_APP_PATH"
    echo "Opening existing app..."
    open "$VERSIONED_APP_PATH" || true
    return 0
  fi

  # Download if ZIP not present
  if [[ -f "$ZIP_PATH" ]]; then
    echo "ZIP already downloaded: $ZIP_PATH"
  else
    echo "Downloading ${FILENAME} from ${URL} → ${ZIP_PATH}"
    if ! curl --fail -L --progress-bar -o "$ZIP_PATH" "$URL"; then
      echo "ERROR: download failed for ${VERSION}. Check that the release/asset exists."
      return 1
    fi
  fi

  echo "Extracting ${ZIP_PATH} to ${TARGET_DIR}..."
  unzip -o "$ZIP_PATH" -d "$TARGET_DIR" >/dev/null

  # Find Bruno.app
  local FOUND_APP_PATH
  FOUND_APP_PATH="$(find "$TARGET_DIR" -maxdepth 4 -type d -name 'Bruno.app' -print -quit || true)"

  if [[ -z "$FOUND_APP_PATH" ]]; then
    echo "ERROR: Bruno.app was not found after extracting ${ZIP_PATH}."
    echo "Contents of ${TARGET_DIR}:"
    ls -la "$TARGET_DIR" || true
    return 1
  fi

  # Rename to versioned app
  echo "Renaming extracted app:"
  echo "  $FOUND_APP_PATH → $VERSIONED_APP_PATH"
  mv "$FOUND_APP_PATH" "$VERSIONED_APP_PATH"

  echo "Installed Bruno-${VERSION} at:"
  echo "  $VERSIONED_APP_PATH"

  # Open the installed app
  echo "Opening Bruno-${VERSION}.app..."
  open "$VERSIONED_APP_PATH" || true

  return 0
}

# Loop over all version args and install each
EXIT_CODE=0
for ver in "$@"; do
  if ! install_version "$ver"; then
    echo "Failed to install version: $ver"
    EXIT_CODE=1
  fi
done

echo
if [[ $EXIT_CODE -eq 0 ]]; then
  echo "All requested versions processed."
else
  echo "One or more installs failed (see messages above)."
fi

exit $EXIT_CODE
