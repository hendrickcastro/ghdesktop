import * as Path from 'path'
import * as Fs from 'fs'

import { getProductName, getVersion } from '../app/package-info'
import { join } from 'path'

const productName = getProductName()
const version = getVersion()

const projectRoot = Path.join(__dirname, '..')

export function getDistRoot() {
  return Path.join(projectRoot, 'dist')
}

export function getDistPath() {
  return Path.join(
    getDistRoot(),
    `${getExecutableName()}-${process.platform}-${getDistArchitecture()}`
  )
}

export function getExecutableName() {
  const suffix = process.env.NODE_ENV === 'development' ? '-dev' : ''

  if (process.platform === 'win32') {
    return `${getWindowsIdentifierName()}${suffix}`
  } else if (process.platform === 'linux') {
    return 'desktop'
  } else {
    return productName
  }
}

export function getOSXZipName() {
  return `${productName}-${getDistArchitecture()}.zip`
}

export function getOSXZipPath() {
  return Path.join(getDistPath(), '..', getOSXZipName())
}

export function getWindowsInstallerName() {
  const productName = getExecutableName()
  return `${productName}Setup-${getDistArchitecture()}.msi`
}

export function getWindowsInstallerPath() {
  return Path.join(getDistPath(), '..', 'installer', getWindowsInstallerName())
}

export function getWindowsStandaloneName() {
  const productName = getExecutableName()
  return `${productName}Setup-${getDistArchitecture()}.exe`
}

export function getWindowsStandalonePath() {
  return Path.join(getDistPath(), '..', 'installer', getWindowsStandaloneName())
}

export function getWindowsFullNugetPackageName(
  includeArchitecture: boolean = false
) {
  const architectureInfix = includeArchitecture
    ? `-${getDistArchitecture()}`
    : ''
  return `${getWindowsIdentifierName()}-${version}${architectureInfix}-full.nupkg`
}

export function getWindowsFullNugetPackagePath() {
  return Path.join(
    getDistPath(),
    '..',
    'installer',
    getWindowsFullNugetPackageName()
  )
}

export function getWindowsDeltaNugetPackageName(
  includeArchitecture: boolean = false
) {
  const architectureInfix = includeArchitecture
    ? `-${getDistArchitecture()}`
    : ''
  return `${getWindowsIdentifierName()}-${version}${architectureInfix}-delta.nupkg`
}

export function getWindowsDeltaNugetPackagePath() {
  return Path.join(
    getDistPath(),
    '..',
    'installer',
    getWindowsDeltaNugetPackageName()
  )
}

export function getWindowsIdentifierName() {
  return 'GitHubDesktopKNWR'
}

export function getBundleSizes() {
  const outPath = Path.join(projectRoot, 'out')
  return {
    // eslint-disable-next-line no-sync
    rendererBundleSize: Fs.statSync(Path.join(outPath, 'renderer.js')).size,
    // eslint-disable-next-line no-sync
    mainBundleSize: Fs.statSync(Path.join(outPath, 'main.js')).size,
  }
}
export const isPublishable = () =>
  ['production', 'beta', 'test'].includes(getChannel())

export const getChannel = () =>
  process.env.RELEASE_CHANNEL ?? process.env.NODE_ENV ?? 'development'

export function getDistArchitecture(): 'arm64' | 'x64' {
  // If a specific npm_config_arch is set, we use that one instead of the OS arch (to support cross compilation)
  if (
    process.env.npm_config_arch === 'arm64' ||
    process.env.npm_config_arch === 'x64'
  ) {
    return process.env.npm_config_arch
  }

  if (process.arch === 'arm64') {
    return 'arm64'
  }

  // TODO: Check if it's x64 running on an arm64 Windows with IsWow64Process2
  // More info: https://www.rudyhuyn.com/blog/2017/12/13/how-to-detect-that-your-x86-application-runs-on-windows-on-arm/
  // Right now (March 3, 2021) is not very important because support for x64
  // apps on an arm64 Windows is experimental. See:
  // https://blogs.windows.com/windows-insider/2020/12/10/introducing-x64-emulation-in-preview-for-windows-10-on-arm-pcs-to-the-windows-insider-program/

  return 'x64'
}

/**
 * Whether this build should check Squirrel's feed for updates.
 *
 * This fork doesn't run an update server of its own, and upstream's feed
 * (desktop/desktop on Central) serves vanilla GitHub Desktop. Left enabled, the
 * first background check silently replaces this build with upstream's - fork
 * features and all. Point DESKTOP_UPDATES_URL at a feed we control to opt back
 * in.
 *
 * Note this only governs the Squirrel feed. Updates from the fork's GitHub
 * releases are a separate path - see getUpdatesGitHubRepository.
 */
export const areUpdatesDisabled = () =>
  process.env.DESKTOP_UPDATES_URL === undefined

/**
 * The `owner/repo` whose GitHub releases this build updates itself from.
 *
 * Squirrel can't serve this fork: its Mac updater refuses anything that isn't
 * signed with a stable Developer ID, and these builds are ad-hoc signed. So the
 * app reads the fork's releases directly instead - see
 * app/src/main-process/github-updater.ts.
 *
 * Set DESKTOP_UPDATES_GITHUB_REPO to point a build somewhere else, or to an
 * empty string to build an app that never checks.
 */
export const getUpdatesGitHubRepository = () =>
  process.env.DESKTOP_UPDATES_GITHUB_REPO ?? 'hendrickcastro/ghdesktop'

export function getUpdatesURL() {
  if (process.env.DESKTOP_UPDATES_URL !== undefined) {
    return process.env.DESKTOP_UPDATES_URL
  }

  // It is also possible to use a `x64/` path, but for now we'll leave the
  // original URL without architecture in it (which will still work for
  // compatibility reasons) in case anything goes wrong until we have everything
  // sorted out.
  const architecturePath = getDistArchitecture() === 'arm64' ? 'arm64/' : ''
  return `https://central.github.com/api/deployments/desktop/desktop/${architecturePath}latest?version=${version}&env=${getChannel()}`
}

export function shouldMakeDelta() {
  // Only production and beta channels include deltas. Test releases aren't
  // necessarily sequential so deltas wouldn't make sense.
  return ['production', 'beta'].includes(getChannel())
}

/**
 * Path to the directory containing all icon assets for the current release channel.
 */
export function getIconDirectory() {
  const devOrProd = getChannel() === 'development' ? 'dev' : 'prod'
  return join(projectRoot, 'app', 'static', 'logos', devOrProd)
}

export function getChannelFromReleaseBranch(): string {
  const branchName = process.env.GITHUB_HEAD_REF ?? ''

  if (!branchName.includes('releases/')) {
    return 'development'
  }

  if (getVersion().includes('test')) {
    return 'test'
  }

  if (getVersion().includes('beta')) {
    return 'beta'
  }

  return 'production'
}
