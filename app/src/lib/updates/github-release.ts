import * as semver from 'semver'

/** A downloadable file attached to a GitHub release. */
export interface IGitHubReleaseAsset {
  readonly name: string
  readonly url: string
  /** Size in bytes, as reported by the API. Zero when unknown. */
  readonly size: number
}

/** A release newer than the running build, with the file to install. */
export interface IGitHubUpdate {
  readonly version: string
  readonly tagName: string
  /** The release's page on github.com, for "what's new". */
  readonly releaseUrl: string
  readonly publishedAt: string
  readonly asset: IGitHubReleaseAsset
}

/** How far along the download of an update is. */
export interface IUpdateDownloadProgress {
  /** Bytes written so far. */
  readonly transferred: number
  /** Total bytes, or 0 when the server didn't say how big the file is. */
  readonly total: number
}

/** The subset of the releases API this module relies on. */
interface IReleaseResponse {
  readonly tag_name?: unknown
  readonly html_url?: unknown
  readonly published_at?: unknown
  readonly draft?: unknown
  readonly prerelease?: unknown
  readonly assets?: unknown
}

/**
 * Pulls the version out of a release tag.
 *
 * Tags in this fork look like `ghknwr-3.5.10`, but `v3.5.10` and a bare
 * `3.5.10` are just as plausible for a future release, so take the version off
 * the end of the tag rather than assuming one prefix.
 */
export function parseReleaseVersion(tagName: string): string | null {
  const match = /(\d+\.\d+\.\d+(?:-[0-9a-z.]+)?)$/i.exec(tagName.trim())
  return match === null ? null : match[1]
}

/** The architecture spellings that count as a match for the running build. */
function architectureAliases(arch: string): ReadonlyArray<string> {
  switch (arch) {
    case 'arm64':
      return ['arm64', 'aarch64', 'universal']
    case 'x64':
      return ['x64', 'x86_64', 'x86-64', 'amd64', 'intel', 'universal']
    default:
      return [arch]
  }
}

/** Every architecture an asset name could be claiming. */
const AllArchitectureTokens = [
  'arm64',
  'aarch64',
  'x64',
  'x86_64',
  'x86-64',
  'amd64',
  'intel',
  'universal',
]

/**
 * Whether an asset built for `arch` can be installed on this machine.
 *
 * An asset that names no architecture is assumed to be the only build on offer
 * and therefore ours; one that names a different architecture never is. Without
 * the second half of that rule an Apple silicon machine would happily install
 * an x64 build and quietly run the whole app under Rosetta.
 */
function matchesArchitecture(name: string, arch: string): boolean {
  const lower = name.toLowerCase()
  const aliases = architectureAliases(arch)

  if (aliases.some(alias => lower.includes(alias))) {
    return true
  }

  return !AllArchitectureTokens.some(token => lower.includes(token))
}

/**
 * The asset to install on this platform, or null when the release has nothing
 * for it - which happens routinely here, since releases are cut per platform as
 * builds finish.
 *
 * macOS prefers a zip over a dmg because it installs with one `ditto` and no
 * disk image to mount. Windows takes only the Squirrel `Setup.exe`: it upgrades
 * an existing install in place and relaunches, where the `.msi` prompts for
 * admin rights and doesn't.
 */
export function pickUpdateAsset(
  assets: ReadonlyArray<IGitHubReleaseAsset>,
  platform: string,
  arch: string
): IGitHubReleaseAsset | null {
  const candidates = assets.filter(a => matchesArchitecture(a.name, arch))
  const byExtension = (ext: string) =>
    candidates.find(a => a.name.toLowerCase().endsWith(ext)) ?? null

  switch (platform) {
    case 'darwin':
      return byExtension('.zip') ?? byExtension('.dmg')
    case 'win32':
      return (
        candidates.find(a => /setup.*\.exe$/i.test(a.name)) ??
        byExtension('.exe')
      )
    default:
      // No Linux builds are published, and Desktop's Linux packaging is handled
      // by distro maintainers rather than by this updater.
      return null
  }
}

function parseAssets(value: unknown): ReadonlyArray<IGitHubReleaseAsset> {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((asset: any) =>
    typeof asset?.name === 'string' &&
    typeof asset?.browser_download_url === 'string'
      ? [
          {
            name: asset.name,
            url: asset.browser_download_url,
            size: typeof asset.size === 'number' ? asset.size : 0,
          },
        ]
      : []
  )
}

/**
 * Turns an API release into an update, or null when it's one we can't or
 * shouldn't install.
 */
function toUpdate(
  release: IReleaseResponse,
  platform: string,
  arch: string,
  allowPrerelease: boolean
): IGitHubUpdate | null {
  if (release.draft === true) {
    return null
  }

  if (release.prerelease === true && !allowPrerelease) {
    return null
  }

  const tagName = typeof release.tag_name === 'string' ? release.tag_name : ''
  const version = parseReleaseVersion(tagName)

  if (version === null || semver.valid(version) === null) {
    return null
  }

  const asset = pickUpdateAsset(parseAssets(release.assets), platform, arch)

  if (asset === null) {
    return null
  }

  return {
    version,
    tagName,
    // Empty when the API omits it, which callers fall back to the repository's
    // releases page for.
    releaseUrl: typeof release.html_url === 'string' ? release.html_url : '',
    publishedAt:
      typeof release.published_at === 'string' ? release.published_at : '',
    asset,
  }
}

/** The releases page for a `owner/repo`, for links out to github.com. */
export function releasesUrl(repository: string): string {
  return `https://github.com/${repository}/releases`
}

interface IFindUpdateOptions {
  /** The `owner/repo` to read releases from. */
  readonly repository: string
  /** The version of the running app. */
  readonly currentVersion: string
  readonly platform: string
  readonly arch: string
  readonly userAgent: string
  /** Whether to consider releases marked as pre-releases. */
  readonly allowPrerelease: boolean
}

/**
 * The newest release that is both installable on this machine and newer than
 * the running build, or null when there's nothing to install.
 *
 * Reads a page of releases rather than `/releases/latest` on purpose: releases
 * here are cut per platform as each build finishes, so the newest release
 * overall is regularly one with no asset for the platform asking. Walking the
 * list finds the newest release that actually ships something we can install.
 *
 * @throws If the API can't be reached or refuses the request.
 */
export async function findUpdate(
  options: IFindUpdateOptions
): Promise<IGitHubUpdate | null> {
  const {
    repository,
    currentVersion,
    platform,
    arch,
    userAgent,
    allowPrerelease,
  } = options

  const response = await fetch(
    `https://api.github.com/repos/${repository}/releases?per_page=30`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': userAgent,
      },
    }
  )

  if (!response.ok) {
    // Unauthenticated calls get 60 requests an hour per IP, which a four-hourly
    // check never approaches on its own - but a shared IP or a burst of manual
    // checks can, and the bare status code doesn't hint at that at all.
    if (response.status === 403 || response.status === 429) {
      throw new Error(
        `GitHub rate-limited the update check (${response.status}). It should work again within the hour.`
      )
    }

    throw new Error(
      `Could not read releases from ${repository} (${response.status} ${response.statusText})`
    )
  }

  const body = await response.json()

  if (!Array.isArray(body)) {
    throw new Error(
      `Unexpected response when reading releases from ${repository}`
    )
  }

  const current = semver.valid(semver.coerce(currentVersion) ?? '')

  if (current === null) {
    throw new Error(`Could not parse the running version "${currentVersion}"`)
  }

  return (
    body
      .flatMap(release => {
        const update = toUpdate(release, platform, arch, allowPrerelease)
        return update !== null && semver.gt(update.version, current)
          ? [update]
          : []
      })
      .sort((a, b) => semver.rcompare(a.version, b.version))[0] ?? null
  )
}
