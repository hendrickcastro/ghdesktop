#!/bin/bash
#
# Installs GitHub Desktop KNWR on macOS:
#
#   curl -sL https://raw.githubusercontent.com/hendrickcastro/ghdesktop/production/install.sh | bash
#
# These builds are ad-hoc signed - there is no Apple developer account behind
# them - so a copy dragged out of the disk image is quarantined and macOS refuses
# to launch it ("Apple could not verify ... is free of malware"). This does the
# same install and clears the flag, which is the only part a person can't do by
# dragging. Updates after this are handled by the app itself.
set -euo pipefail

REPO="${GHDESKTOP_REPO:-hendrickcastro/ghdesktop}"
APP_NAME="GitHub Desktop KNWR.app"
TARGET="/Applications/$APP_NAME"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This installer is for macOS. On Windows, run GitHubDesktopKNWRSetup-x64.exe." >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

echo "Looking up the latest release of $REPO…"

# Prefer the zip: it installs with one ditto and no disk image to mount. Fall
# back to the dmg, which is what releases have carried so far.
ASSET_URL=$(
  curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
    grep -o '"browser_download_url": *"[^"]*"' |
    sed 's/.*"browser_download_url": *"\([^"]*\)"/\1/' |
    grep -E "\-$ARCH\.(zip|dmg)$" |
    sort |
    head -1
)

if [ -z "$ASSET_URL" ]; then
  echo "The latest release has no macOS $ARCH build." >&2
  echo "See https://github.com/$REPO/releases" >&2
  exit 1
fi

WORK=$(mktemp -d)
# Leave nothing behind, including on failure - these downloads are ~200MB.
trap 'rm -rf "$WORK"; [ -n "${MOUNT:-}" ] && hdiutil detach "$MOUNT" -quiet 2>/dev/null || true' EXIT

FILENAME=$(basename "$ASSET_URL")
echo "Downloading $FILENAME…"
curl -fL --progress-bar "$ASSET_URL" -o "$WORK/$FILENAME"

case "$FILENAME" in
  *.zip)
    echo "Extracting…"
    ditto -xk "$WORK/$FILENAME" "$WORK/extracted"
    SOURCE=$(find "$WORK/extracted" -maxdepth 1 -name '*.app' -print -quit)
    ;;
  *.dmg)
    echo "Mounting…"
    MOUNT="$WORK/mount"
    mkdir -p "$MOUNT"
    hdiutil attach "$WORK/$FILENAME" -nobrowse -readonly -mountpoint "$MOUNT" >/dev/null
    SOURCE=$(find "$MOUNT" -maxdepth 1 -name '*.app' -print -quit)
    ;;
esac

if [ -z "${SOURCE:-}" ]; then
  echo "Couldn't find an app bundle in $FILENAME." >&2
  exit 1
fi

# Quit a running copy first: replacing the bundle under it leaves the running app
# in a broken half-state.
if pgrep -f "$TARGET/Contents/MacOS/" >/dev/null 2>&1; then
  echo "Quitting the running app…"
  osascript -e "quit app \"${APP_NAME%.app}\"" 2>/dev/null || true
  for _ in $(seq 1 20); do
    pgrep -f "$TARGET/Contents/MacOS/" >/dev/null 2>&1 || break
    sleep 0.5
  done
fi

echo "Installing to /Applications…"
# Keep the old copy until the new one is in place, so a failure here doesn't
# leave the machine with no app at all.
BACKUP=""
if [ -d "$TARGET" ]; then
  BACKUP="$TARGET.previous"
  rm -rf "$BACKUP"
  mv "$TARGET" "$BACKUP"
fi

if ! ditto "$SOURCE" "$TARGET"; then
  echo "Install failed." >&2
  if [ -n "$BACKUP" ]; then
    echo "Restoring the previous version." >&2
    rm -rf "$TARGET"
    mv "$BACKUP" "$TARGET"
  fi
  exit 1
fi

rm -rf "$BACKUP"

# The reason this script exists: without clearing the download flag, Gatekeeper
# blocks the first launch outright.
xattr -cr "$TARGET"

# Only re-sign if the bundle doesn't already carry a signature macOS accepts. A
# blanket ad-hoc re-sign would throw away a real Developer ID signature if these
# builds ever get one.
if ! codesign --verify --deep --strict "$TARGET" >/dev/null 2>&1; then
  echo "Re-signing the bundle…"
  codesign --force --deep --sign - "$TARGET"
fi

echo "Launching…"
open "$TARGET"

echo "Done. Updates from here on are automatic - the app checks this repository's"
echo "releases and installs them when you quit."
