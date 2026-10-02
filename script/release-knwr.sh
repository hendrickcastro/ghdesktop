#!/usr/bin/env bash
#
# Builds this machine's installers for a ghknwr-<version> tag and uploads them
# to that tag's GitHub release - the manual stand-in for the Release KNWR
# workflow, which this fork doesn't run.
#
#   script/release-knwr.sh ghknwr-3.6.0            # build + upload
#   script/release-knwr.sh ghknwr-3.6.0 --publish  # ...then publish the release
#
# Run it once on a Mac (arm64 .dmg and .zip) and once on Windows (x64 .exe and
# .msi, from Git Bash). Each run creates the draft release if it isn't there
# yet and replaces its own platform's assets, so reruns are safe. Pass
# --publish on the second machine: it only takes the release out of draft once
# all four assets are on it, because the updater picks assets by name.
#
# Needs: gh signed in with write access to the repository, the checkout at the
# tag (already pushed), and the OAuth app credentials in the environment -
# DESKTOP_OAUTH_CLIENT_ID and DESKTOP_OAUTH_CLIENT_SECRET, the same values as
# the repository secrets. Without them the build would carry the development
# OAuth app and signing in to GitHub would fail.

set -euo pipefail

die() {
  echo "release-knwr: $*" >&2
  exit 1
}

TAG="${1:-}"
PUBLISH="${2:-}"
[ -n "$TAG" ] || die "usage: script/release-knwr.sh ghknwr-<version> [--publish]"
[ -z "$PUBLISH" ] || [ "$PUBLISH" = "--publish" ] || die "unknown option '$PUBLISH'"

REPO="${DESKTOP_UPDATES_GITHUB_REPO:-hendrickcastro/ghdesktop}"

# Everything after the last dash is the version - the same rule the updater
# applies when it reads the tag back.
VERSION="${TAG##*-}"
printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+' ||
  die "tag '$TAG' doesn't end in a version the updater can parse"

cd "$(dirname "$0")/.."

case "$(uname -s)" in
  Darwin) PLATFORM=macos ARCH=arm64 ;;
  MINGW* | MSYS* | CYGWIN*) PLATFORM=windows ARCH=x64 ;;
  *) die "builds are made on macOS or Windows, not $(uname -s)" ;;
esac

# --- Preconditions -----------------------------------------------------------

git rev-parse -q --verify "refs/tags/$TAG" >/dev/null ||
  die "no local tag $TAG - fetch it (git fetch --tags) or create it first"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "$TAG^{commit}")" ] ||
  die "HEAD isn't $TAG - run: git checkout $TAG"
[ -z "$(git status --porcelain --untracked-files=no)" ] ||
  die "the working tree has changes; the build must be exactly the tag"
git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null ||
  die "$TAG isn't on origin - run: git push origin $TAG"

PACKAGE_VERSION="$(node -p "require('./app/package.json').version")"
[ "$PACKAGE_VERSION" = "$VERSION" ] ||
  die "app/package.json says $PACKAGE_VERSION but the tag says $VERSION - bump the version in the tagged commit"

REQUIRED_NODE="$(tr -d 'v[:space:]' <.nvmrc)"
[ "$(node -p 'process.versions.node')" = "$REQUIRED_NODE" ] ||
  die "Node $REQUIRED_NODE is required (.nvmrc), found $(node -v)"

[ -n "${DESKTOP_OAUTH_CLIENT_ID:-}" ] && [ -n "${DESKTOP_OAUTH_CLIENT_SECRET:-}" ] ||
  die "set DESKTOP_OAUTH_CLIENT_ID and DESKTOP_OAUTH_CLIENT_SECRET"

gh auth status >/dev/null 2>&1 || die "gh isn't signed in - run: gh auth login"

# --- Build -------------------------------------------------------------------

export RELEASE_CHANNEL=production
export DESKTOP_UPDATES_GITHUB_REPO="$REPO"
export npm_config_arch="$ARCH" TARGET_ARCH="$ARCH"

if [ "$PLATFORM" = windows ]; then
  # node-gyp builds racing each other on Windows fail with "the process cannot
  # access the file because it is being used by another process".
  export YARN_CHILD_CONCURRENCY=1
fi

echo "Building GitHub Desktop KNWR $VERSION for $PLATFORM ($ARCH)…"
yarn install --frozen-lockfile
yarn build:prod
yarn package

if [ "$PLATFORM" = macos ]; then
  shopt -s nullglob
  apps=(dist/*/*.app)
  [ "${#apps[@]}" -gt 0 ] || die "no .app under dist/"
  APP="${apps[0]}"

  # Ad-hoc signed builds can come out of packaging with a nested framework
  # whose signature doesn't match the bundle's, which dyld refuses to load.
  # Re-signing the whole thing makes it consistent.
  codesign --force --deep --sign - "$APP"
  xattr -rc "$APP"

  DMG="dist/GitHubDesktopKNWR-arm64.dmg"
  STAGING="dist/dmg-staging"
  rm -rf "$STAGING" "$DMG"
  mkdir -p "$STAGING"
  cp -R "$APP" "$STAGING/"
  # The symlink is what makes the disk image a drag-and-drop installer.
  ln -s /Applications "$STAGING/Applications"
  hdiutil create -volname "GitHub Desktop KNWR" -srcfolder "$STAGING" \
    -ov -format UDBZ "$DMG"
  rm -rf "$STAGING"

  # yarn package writes a zip whose name carries spaces. The updater prefers a
  # zip over a disk image, so give it a name that survives a URL.
  zips=(dist/*.zip)
  [ "${#zips[@]}" -gt 0 ] || die "no .zip under dist/"
  mv "${zips[0]}" dist/GitHubDesktopKNWR-arm64.zip

  ASSETS=("$DMG" dist/GitHubDesktopKNWR-arm64.zip)
else
  ASSETS=(dist/GitHubDesktopKNWRSetup-x64.exe dist/GitHubDesktopKNWRSetup-x64.msi)
fi

for asset in "${ASSETS[@]}"; do
  [ -f "$asset" ] || die "expected $asset after packaging"
done
ls -lh "${ASSETS[@]}"

# --- Upload ------------------------------------------------------------------

if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  NOTES="$(mktemp)"
  # Quoted heredoc so backticks stay backticks; placeholders are filled below.
  cat <<'NOTES' >"$NOTES"
## GitHub Desktop KNWR __VERSION__

### Install

**macOS (Apple Silicon) — one command:**

```sh
curl -sL https://raw.githubusercontent.com/__REPO__/__TAG__/install.sh | bash
```

Installs to /Applications, clears the macOS quarantine flag, and opens the app.

Opening `GitHubDesktopKNWR-arm64.dmg` and dragging the app across works too,
but macOS will refuse the first launch with *"Apple could not verify GitHub
Desktop KNWR.app is free of malware"*. These builds are ad-hoc signed - there
is no Apple developer account behind them to notarize with - so clear the
quarantine flag once and it opens normally from then on:

```sh
xattr -cr "/Applications/GitHub Desktop KNWR.app"
```

**Windows x64.** Run `GitHubDesktopKNWRSetup-x64.exe` (or the `.msi`).

### Updates

Later versions install themselves: the app checks this repository's releases
on launch and every four hours, downloads what it finds, and swaps itself out
when you quit. **Check for Updates…** in the app menu does it on demand.

### What this fork adds

Folders and favorites, pulling and cloning many repositories at once, Azure
DevOps, commit messages from your own AI provider, and self-updating — all
described in the [feature guide](https://github.com/__REPO__/blob/__TAG__/docs/knwr-features.md).
NOTES
  sed -i.bak "s|__VERSION__|$VERSION|g; s|__REPO__|$REPO|g; s|__TAG__|$TAG|g" "$NOTES"
  rm -f "$NOTES.bak"

  gh release create "$TAG" --repo "$REPO" --verify-tag --draft \
    --title "GitHub Desktop KNWR $VERSION" --notes-file "$NOTES"
  rm -f "$NOTES"
fi

gh release upload "$TAG" "${ASSETS[@]}" --repo "$REPO" --clobber
echo "Uploaded $PLATFORM assets to $TAG."

if [ "$PUBLISH" = "--publish" ]; then
  EXPECTED=(
    GitHubDesktopKNWR-arm64.dmg
    GitHubDesktopKNWR-arm64.zip
    GitHubDesktopKNWRSetup-x64.exe
    GitHubDesktopKNWRSetup-x64.msi
  )
  PRESENT="$(gh release view "$TAG" --repo "$REPO" --json assets -q '.assets[].name')"
  for name in "${EXPECTED[@]}"; do
    printf '%s\n' "$PRESENT" | grep -qx "$name" ||
      die "$name isn't on the release yet - build the other platform first; not publishing"
  done

  gh release edit "$TAG" --repo "$REPO" --draft=false --latest
  echo "Published $TAG."
else
  echo "Still a draft. Once the other platform is up, rerun with --publish."
fi
