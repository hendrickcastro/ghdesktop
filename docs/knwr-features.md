# GitHub Desktop KNWR — feature guide

GitHub Desktop KNWR is a fork of [GitHub Desktop](https://desktop.github.com/)
that keeps everything the official app does and adds what a developer working
across many repositories, several hosting providers and their own AI tooling
kept missing. This guide covers what is different, how to use it, and what to
expect from it.

- [Installing](#installing)
- [Keeping it up to date](#keeping-it-up-to-date)
- [Organizing repositories: favorites and folders](#organizing-repositories-favorites-and-folders)
- [Adding several local repositories at once](#adding-several-local-repositories-at-once)
- [Pulling several repositories at once](#pulling-several-repositories-at-once)
- [Commit messages from your own AI provider](#commit-messages-from-your-own-ai-provider)
- [Azure DevOps](#azure-devops)
- [macOS keychain prompts](#macos-keychain-prompts)
- [Releasing a new version](#releasing-a-new-version)
- [Known limitations](#known-limitations)

## Installing

Releases live at <https://github.com/hendrickcastro/ghdesktop/releases>. Every
release ships:

| File | Platform |
| --- | --- |
| `GitHubDesktopKNWR-arm64.dmg` | macOS, Apple silicon — drag-and-drop installer |
| `GitHubDesktopKNWR-arm64.zip` | macOS, Apple silicon — the bare app bundle |
| `GitHubDesktopKNWRSetup-x64.exe` | Windows x64 — per-user installer |
| `GitHubDesktopKNWRSetup-x64.msi` | Windows x64 — machine-wide installer |

### macOS: one command

```sh
curl -sL https://raw.githubusercontent.com/hendrickcastro/ghdesktop/production/install.sh | bash
```

The script downloads the latest release, installs it to `/Applications`,
clears the quarantine flag, and opens the app. If a copy is already installed
it is replaced, and kept until the new one is in place so a failure never
leaves you without an app. Updates from then on are automatic.

### macOS: by hand

Open the `.dmg` and drag the app to Applications. The first launch will be
refused with *"Apple could not verify GitHub Desktop KNWR.app is free of
malware"*: these builds are ad-hoc signed — there is no Apple developer account
behind them to notarize with. Clear the quarantine flag once and it opens
normally from then on:

```sh
xattr -cr "/Applications/GitHub Desktop KNWR.app"
```

### Windows

Run `GitHubDesktopKNWRSetup-x64.exe`. The installer is not code-signed, so
SmartScreen may ask you to confirm on first run.

The app installs alongside the official GitHub Desktop: it has its own name,
bundle identifier (`com.knwr.GitHubDesktop`) and settings, so the two never
interfere.

## Keeping it up to date

The app updates itself from this repository's GitHub releases:

- On launch and every four hours it checks for a newer release. If there is
  one, it downloads it in the background and installs it **when you quit**, so
  the next launch is the new version.
- **GitHub Desktop KNWR → Check for Updates…** (Help menu on Windows) checks
  on demand and opens About, where you can see the download progress and
  install right away with **Restart and Install Update**.
- The update banner's *what's new* link opens the release's page on GitHub.

Windows installs the downloaded installer when you choose to restart; it does
not install silently on quit.

## Organizing repositories: favorites and folders

### Favorites

Right-click any repository in the sidebar to mark it as a favorite. Favorites
appear in a **Favorites** section at the top of the list with a star icon, and
still show in their usual group.

### Folders

Group repositories into named folders, nested as deep as you like
(`Work / Frontend / React`):

- **Move to Folder** in a repository's right-click menu moves it into an
  existing folder or creates a new one.
- Right-click a folder header to **create a subfolder**, **rename** or
  **delete** it. Deleting a folder returns its repositories to their normal
  group.
- **Remove from folder** puts a repository back in its default group.
- A repository lives in exactly one place: inside its folder, not duplicated
  in the source groups.
- Folders and the Favorites section collapse and expand by clicking the
  header, and remember their state across restarts.

The sidebar's *Recent* section is gone; favorites, folders and source groups
(GitHub.com, Enterprise, other) organize the list instead.

## Adding several local repositories at once

In **File → Add Local Repository**, select several folders with Ctrl/Cmd-click
or Shift-click. The dialog lists what you picked and the button reads
*Add N repositories*.

## Pulling several repositories at once

**Repository → Pull Multiple Repositories…** (⌘⌥⇧P / Ctrl+Alt+Shift+P) opens
a dialog listing every repository with its folder or owner.

- Filter by name, folder or owner. **Select all** applies to what the filter
  shows, so "filter to a folder, select all" works; the checkbox turns
  indeterminate on a partial selection.
- The last batch is remembered, so repeating it is two clicks. The first time,
  everything is selected.
- **Pull N Repositories** pulls three at a time. Each row reports live:
  *Waiting → Pulling → Updated / Already up to date / Skipped / Failed*, and a
  summary line totals them up. No error dialog per repository.

Repositories that can't be pulled are skipped with the reason rather than
attempted: no remote, detached HEAD, no upstream branch, no commits yet, or
another push/pull/fetch already running. Each repository's branches and
remotes are loaded first, so repositories you haven't opened this session are
handled the same as the one you're looking at.

## Commit messages from your own AI provider

Generate commit messages with your own API key instead of GitHub Copilot.

### Setting it up

**Preferences → AI → Use my own AI provider.** Pick a provider — Anthropic,
OpenAI, Google Gemini or OpenRouter — paste an API key, and choose a model.
The key is stored in the OS credential manager, never in the app's settings.

- The model list is fetched from the provider (OpenRouter's is public, the
  others need the key) with prices per million tokens where the provider
  publishes them; OpenAI, Anthropic and Google prices come from the
  community-maintained LiteLLM catalogue and are marked as such.
- **Search models** filters the list by name.
- **Test connection** round-trips a request so you know the key, model and
  endpoint work before relying on them.
- **Endpoint** lets you point at a proxy or a compatible self-hosted API.

### Detail level

**Commit message detail** decides how much the description says:

| Level | Description | Output budget |
| --- | --- | --- |
| Concise (default) | A summary line; a description only when the title doesn't cover it | 1,024 tokens |
| Detailed | Short paragraph, then a bullet per meaningful change naming the files or symbols touched | 2,048 tokens |
| Thorough | *What changed / Why / Impact* sections, including behaviour changes, risks and follow-ups | 4,096 tokens |

Every level is instructed to describe only what the diff shows and not to
guess at intent. The larger budgets also help reasoning models, which spend
part of the output budget thinking before they write; a model that runs out of
budget now says so instead of returning nothing.

### Using it

With your provider enabled, the sparkle button next to the commit summary
generates the message from the selected changes. The Copilot disclaimer is not
shown — you've already agreed to your own provider's terms.

## Azure DevOps

### Connecting an organization

**Preferences → Accounts → Azure DevOps → Add Azure DevOps organization.**
Enter the organization (its name, or paste its URL), your username, and a
personal access token with **Code (Read & Write)** scope. **Test and add**
checks the token against the organization's projects API before storing
anything, and tells you how many team projects it can see.

You can connect several organizations. The token is stored in the OS credential
manager; the app keeps only the organization name and username.

### Cloning

The clone dialog (**File → Clone Repository**, ⇧⌘O) has an **Azure DevOps**
tab:

- Pick the organization (when more than one is connected). Repositories are
  listed **grouped by team project**, with a filter and a refresh button. The
  list is cached for the session, since it takes one request per project.
- Select a repository and **Clone** works like any other tab; the default
  branch comes from Azure.

#### Cloning several at once

Tick repositories — per repository, per team project (the checkbox in the
group header) or **All** (which follows the filter). Ticking anything switches
the tab to multi-clone mode:

- The path becomes the **parent folder**; each repository is cloned into its
  own subfolder named after it.
- As you tick, and as you change the folder, each destination is checked on
  disk. One that already has something in it shows **Already exists**, is
  subtracted from the button (*Clone 4 Repositories*) and is left out — you
  see the conflict before cloning, not as a failure after.
- Clones run three at a time, each with its own progress in the sidebar.

Untick everything to return to single-repository mode.

### Credentials

Every repository under a connected organization authenticates with the
organization's token — including repositories cloned before the organization
was connected, or cloned outside the app. There are no more credential prompts
on fetch and push for those repositories.

The token is read from the credential store once per launch and reused; see
[macOS keychain prompts](#macos-keychain-prompts) for why that matters.

## macOS keychain prompts

macOS ties permission to read a keychain item to the requesting app's code
signature. These builds are ad-hoc signed, and an ad-hoc signature is unique to
each build, so **after every update macOS asks again** for each keychain item
the app touches — a dialog titled *"GitHub Desktop KNWR Helper (Renderer)
wants to use your confidential information…"*.

What the app does to keep this down:

- Azure DevOps repositories use one credential per **organization**, not one
  per repository, and it is read **once per launch**. After an update you get
  at most one prompt per connected organization, regardless of how many
  repositories you have.
- Answer **Always Allow** (it asks for your login password) and the item stops
  prompting until the next update. **Allow** grants a single read.

Removing the prompt entirely needs a signature that doesn't change between
versions: either a self-signed code-signing certificate kept as a repository
secret, or an Apple Developer ID (which also removes the first-launch
"could not verify" warning). Neither is set up yet.

## Releasing a new version

Maintainers publish a release by pushing a tag:

```sh
# bump app/package.json and add a changelog.json entry, then
git tag ghknwr-3.5.18
git push origin ghknwr-3.5.18
```

The **Release KNWR** workflow (`.github/workflows/release-knwr.yml`) drafts
the release, builds macOS (Apple silicon) and Windows (x64) in parallel,
uploads the four assets, and publishes. The version is written into
`app/package.json` from the tag before building, so About and the updater
always match the tag. It can also be run by hand from the Actions tab for an
existing tag.

Rules the updater relies on:

- The tag must **end in the version**: `ghknwr-3.5.18`, `v3.5.18` or
  `3.5.18` all work.
- Asset names must keep their **architecture and extension**:
  `…-arm64.dmg`/`…-arm64.zip` for macOS, `…Setup-x64.exe` for Windows. The
  updater prefers the zip when both are present.
- Releases marked as pre-releases are only offered to beta-channel builds.

Builds are unsigned on Windows and ad-hoc signed on macOS unless the
`APPLE_APPLICATION_CERT`/`APPLE_ID` or Azure Code Signing secrets are
configured, in which case the upstream signing steps run. Two build-time
variables control updates: `DESKTOP_UPDATES_GITHUB_REPO` (the `owner/repo`
whose releases the app updates from; defaults to this repository, empty
disables) and `DESKTOP_UPDATES_URL` (a Squirrel feed, which takes precedence
when set).

## Known limitations

- **macOS builds are Apple silicon only.** Intel Macs would need an x64 build
  (`TARGET_ARCH=x64 yarn build:prod`), which the release workflow doesn't
  produce.
- **Not notarized / not code-signed.** First launch on macOS needs the
  quarantine flag cleared (the installer script does it); Windows shows a
  SmartScreen prompt. See [macOS keychain prompts](#macos-keychain-prompts).
- **Linux** is not built or supported by the updater, as with upstream.
- Release notes inside the app link to the GitHub release rather than
  rendering in the *Release notes* dialog, which is tied to upstream's
  changelog feed.
