import { app } from 'electron'
import { spawn, execFile } from 'child_process'
import { createWriteStream, constants } from 'fs'
import { mkdir, rm, readdir, writeFile, chmod, access } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { promisify } from 'util'
import {
  findUpdate,
  IGitHubUpdate,
  IUpdateDownloadProgress,
} from '../lib/updates/github-release'

const execFileAsync = promisify(execFile)

/**
 * Whether this build updates itself from GitHub releases.
 *
 * Squirrel's feed takes precedence when one is configured, so a build pointed at
 * a real update server keeps using it.
 */
export function isGitHubUpdaterEnabled(): boolean {
  return __UPDATES_GITHUB_REPO__ !== '' && __UPDATES_URL__ === ''
}

export function getUpdatesRepository(): string {
  return __UPDATES_GITHUB_REPO__
}

interface IGitHubUpdaterCallbacks {
  readonly onCheckingForUpdate: () => void
  readonly onUpdateAvailable: () => void
  readonly onUpdateNotAvailable: () => void
  readonly onUpdateDownloaded: (update: IGitHubUpdate) => void
  readonly onDownloadProgress: (progress: IUpdateDownloadProgress) => void
  readonly onError: (error: Error) => void
}

/** An update that has been downloaded and unpacked, ready to be swapped in. */
interface IStagedUpdate {
  readonly update: IGitHubUpdate
  /**
   * What to hand the installer: the unpacked `.app` on macOS, the downloaded
   * installer on Windows.
   */
  readonly payloadPath: string
  /**
   * The shell script that performs the swap on macOS. Written while staging,
   * not while installing, so that installing is a single synchronous spawn -
   * `will-quit` handlers don't wait for promises, so an install that had any
   * async work left would simply never happen.
   */
  readonly installScriptPath: string | null
}

/**
 * Keeps this fork up to date from its own GitHub releases.
 *
 * Electron's built-in updater can't do this job here: Squirrel.Mac only installs
 * updates whose code signature matches the running app's, and these builds are
 * ad-hoc signed, so every build's signature differs from the last. This does the
 * same three steps by hand - find a newer release, download it, swap it in on
 * quit - and reports progress through the same IPC events the Squirrel path
 * uses, so the UI doesn't know the difference.
 */
export class GitHubUpdater {
  private staged: IStagedUpdate | null = null
  private busy = false
  /** Set once an install has been handed off, so it can't be started twice. */
  private installing = false

  public constructor(private readonly callbacks: IGitHubUpdaterCallbacks) {}

  /** Where downloads and unpacked bundles are kept between runs. */
  private get workingDirectory(): string {
    return join(app.getPath('userData'), 'pending-update')
  }

  private get userAgent(): string {
    return `GitHubDesktopKNWR/${app.getVersion()} (${process.platform}; ${
      process.arch
    })`
  }

  /**
   * Looks for a newer release and downloads it if there is one.
   *
   * Resolves once the work is done or has failed; progress is reported through
   * the callbacks rather than the return value, to match how the renderer
   * already consumes Squirrel's events.
   */
  public async checkForUpdates(): Promise<void> {
    if (this.busy) {
      return
    }

    // Nothing to gain from finding a second update while one is waiting, and
    // downloading over the staged copy would strand the install that's pending.
    if (this.staged !== null) {
      this.callbacks.onUpdateDownloaded(this.staged.update)
      return
    }

    this.busy = true

    try {
      this.callbacks.onCheckingForUpdate()

      const update = await findUpdate({
        repository: getUpdatesRepository(),
        currentVersion: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        userAgent: this.userAgent,
        allowPrerelease: __RELEASE_CHANNEL__ === 'beta',
      })

      if (update === null) {
        // Logged even though nothing happened: without it a check that found
        // nothing is indistinguishable from a check that never ran.
        log.info(
          `[GitHubUpdater] ${app.getVersion()} is the newest release for ${
            process.platform
          }/${process.arch}`
        )
        this.callbacks.onUpdateNotAvailable()
        return
      }

      log.info(
        `[GitHubUpdater] ${update.version} is available (${update.asset.name})`
      )
      this.callbacks.onUpdateAvailable()

      this.staged = await this.download(update)
      this.callbacks.onUpdateDownloaded(update)
    } catch (e) {
      log.error('[GitHubUpdater] update check failed', e)
      this.callbacks.onError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      this.busy = false
    }
  }

  /**
   * Downloads and unpacks an update.
   *
   * The working directory is cleared first: a half-finished download from a
   * previous run is worthless, and these payloads run to hundreds of megabytes.
   */
  private async download(update: IGitHubUpdate): Promise<IStagedUpdate> {
    const root = this.workingDirectory
    await rm(root, { recursive: true, force: true })
    await mkdir(root, { recursive: true })

    const downloadPath = join(root, update.asset.name)

    const response = await fetch(update.asset.url, {
      headers: { 'user-agent': this.userAgent },
    })

    if (!response.ok || response.body === null) {
      throw new Error(
        `Could not download ${update.asset.name} (${response.status} ${response.statusText})`
      )
    }

    const declared = Number.parseInt(
      response.headers.get('content-length') ?? '',
      10
    )
    const total = Number.isFinite(declared) ? declared : update.asset.size
    let transferred = 0
    let lastReported = 0

    const body = Readable.fromWeb(response.body as any)

    body.on('data', (chunk: Buffer) => {
      transferred += chunk.length

      // Once per megabyte. Every chunk would be thousands of IPC messages for a
      // 200MB download, all to move a progress bar a fraction of a pixel.
      if (transferred - lastReported >= 1024 * 1024) {
        lastReported = transferred
        this.callbacks.onDownloadProgress({ transferred, total })
      }
    })

    await pipeline(body, createWriteStream(downloadPath))
    this.callbacks.onDownloadProgress({ transferred, total })

    log.info(`[GitHubUpdater] downloaded ${update.asset.name}`)

    if (process.platform === 'win32') {
      // Squirrel's installer needs no unpacking - running it upgrades the
      // existing install in place.
      return { update, payloadPath: downloadPath, installScriptPath: null }
    }

    const payloadPath = await this.unpackMacOSBundle(downloadPath, root)
    const installScriptPath = await this.writeMacOSInstallScript()

    return { update, payloadPath, installScriptPath }
  }

  /**
   * Unpacks the downloaded archive and returns the path to the `.app` inside it.
   *
   * @throws If the archive can't be unpacked, holds no app bundle, or holds one
   *         that isn't a build of this app.
   */
  private async unpackMacOSBundle(
    downloadPath: string,
    root: string
  ): Promise<string> {
    const stagingPath = join(root, 'staged')
    await mkdir(stagingPath, { recursive: true })

    if (downloadPath.toLowerCase().endsWith('.dmg')) {
      await this.extractFromDiskImage(downloadPath, stagingPath)
    } else {
      await execFileAsync('/usr/bin/ditto', ['-xk', downloadPath, stagingPath])
    }

    const entries = await readdir(stagingPath)
    const bundleName = entries.find(e => e.endsWith('.app'))

    if (bundleName === undefined) {
      throw new Error(
        `The downloaded update didn't contain an app bundle (found: ${
          entries.join(', ') || 'nothing'
        })`
      )
    }

    const bundlePath = join(stagingPath, bundleName)
    await this.assertSameApp(bundlePath)

    // The archive came off the internet, so everything in it is quarantined.
    // Left in place Gatekeeper refuses to launch the update - these builds are
    // ad-hoc signed, so there's no notarization ticket to satisfy it with. This
    // is the same `xattr` the release notes ask users to run by hand.
    await execFileAsync('/usr/bin/xattr', ['-cr', bundlePath])

    return bundlePath
  }

  /** Copies the app bundle out of a mounted disk image, then unmounts it. */
  private async extractFromDiskImage(
    dmgPath: string,
    stagingPath: string
  ): Promise<void> {
    const { stdout } = await execFileAsync('/usr/bin/hdiutil', [
      'attach',
      dmgPath,
      '-nobrowse',
      '-readonly',
      '-noverify',
      '-plist',
    ])

    // The plist lists every entry in the image; the one with a mount point is
    // the volume we want.
    const mountPoint =
      /<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/.exec(stdout)?.[1]

    if (mountPoint === undefined) {
      throw new Error(`Could not mount ${basename(dmgPath)}`)
    }

    try {
      const entries = await readdir(mountPoint)
      const bundleName = entries.find(e => e.endsWith('.app'))

      if (bundleName === undefined) {
        throw new Error(`${basename(dmgPath)} contained no app bundle`)
      }

      await execFileAsync('/usr/bin/ditto', [
        join(mountPoint, bundleName),
        join(stagingPath, bundleName),
      ])
    } finally {
      // Detach either way: a mounted image left behind blocks the next attempt
      // and shows up as a stray disk in Finder.
      await execFileAsync('/usr/bin/hdiutil', [
        'detach',
        mountPoint,
        '-force',
      ]).catch(e =>
        log.warn(`[GitHubUpdater] could not detach ${mountPoint}`, e)
      )
    }
  }

  /** The `.app` the running process lives in. */
  private getInstalledBundlePath(): string {
    // .../GitHub Desktop KNWR.app/Contents/MacOS/GitHub Desktop KNWR
    const bundlePath = dirname(dirname(dirname(app.getPath('exe'))))

    if (!bundlePath.endsWith('.app')) {
      throw new Error(
        "This copy of the app isn't running from an app bundle, so it can't update itself. Install it into Applications first."
      )
    }

    return bundlePath
  }

  /**
   * Refuses to install anything that isn't another build of this app.
   *
   * The install step replaces a directory in Applications, so being wrong here
   * is expensive. Comparing bundle identifiers catches a mispicked asset - say
   * a release that attached some other project's build - before anything is
   * moved.
   */
  private async assertSameApp(candidateBundlePath: string): Promise<void> {
    const readIdentifier = async (bundlePath: string) => {
      const { stdout } = await execFileAsync('/usr/bin/plutil', [
        '-extract',
        'CFBundleIdentifier',
        'raw',
        '-o',
        '-',
        join(bundlePath, 'Contents', 'Info.plist'),
      ])
      return stdout.trim()
    }

    const [installed, candidate] = await Promise.all([
      readIdentifier(this.getInstalledBundlePath()),
      readIdentifier(candidateBundlePath),
    ])

    if (installed !== candidate) {
      throw new Error(
        `The downloaded update is a different application (${candidate} rather than ${installed}), so it wasn't installed.`
      )
    }
  }

  /**
   * Installs the staged update, quitting the app to do it.
   *
   * Synchronous up to the point the work is handed off, so it can be called from
   * a `will-quit` handler.
   *
   * @param relaunch Whether to start the app again once the update is in place.
   *                 False when the user is quitting anyway - reopening the app
   *                 they just closed would be its own kind of rude.
   * @returns Whether an install was started.
   */
  public install(relaunch: boolean): boolean {
    const staged = this.staged

    if (staged === null || this.installing) {
      return false
    }

    this.installing = true

    try {
      if (process.platform === 'win32') {
        // Squirrel's installer does the rest: it upgrades the install in place
        // and starts the new version itself.
        spawn(staged.payloadPath, [], {
          detached: true,
          stdio: 'ignore',
        }).unref()
      } else {
        if (staged.installScriptPath === null) {
          throw new Error('The update was staged without an install script')
        }

        spawn(
          '/bin/sh',
          [
            staged.installScriptPath,
            String(process.pid),
            staged.payloadPath,
            this.getInstalledBundlePath(),
            relaunch ? '1' : '0',
          ],
          { detached: true, stdio: 'ignore' }
        ).unref()
      }

      log.info(`[GitHubUpdater] installing ${staged.update.version}`)
      app.quit()
      return true
    } catch (e) {
      this.installing = false
      log.error('[GitHubUpdater] install failed', e)
      this.callbacks.onError(e instanceof Error ? e : new Error(String(e)))
      return false
    }
  }

  /**
   * Writes the script that performs the swap on macOS.
   *
   * A process can't replace the bundle it's executing from and live to tell the
   * tale, so the script waits for this one to exit first. It keeps the old
   * bundle until the copy succeeds and puts it back if it doesn't, so a failed
   * update leaves the user with a working app rather than none.
   */
  private async writeMacOSInstallScript(): Promise<string> {
    // Applications is writable by the admin group, but an app installed by
    // another user - or sitting in a read-only location - isn't ours to replace.
    // Better to fail now, with the update merely not installed, than after the
    // running copy has been moved out of the way.
    await access(this.getInstalledBundlePath(), constants.W_OK)

    const scriptPath = join(this.workingDirectory, 'install-update.sh')

    await writeFile(
      scriptPath,
      [
        '#!/bin/sh',
        '# Written by GitHubUpdater. Replaces the app bundle once the app has quit.',
        'pid="$1"',
        'staged="$2"',
        'target="$3"',
        'relaunch="$4"',
        '',
        '# Give the app a minute to shut down before giving up on it.',
        'waited=0',
        'while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt 120 ]; do',
        '  sleep 0.5',
        '  waited=$((waited + 1))',
        'done',
        '',
        'if kill -0 "$pid" 2>/dev/null; then',
        '  echo "app still running, not installing" >&2',
        '  exit 1',
        'fi',
        '',
        'backup="${target}.updating"',
        '/bin/rm -rf "$backup"',
        '/bin/mv "$target" "$backup" || exit 1',
        '',
        'if /usr/bin/ditto "$staged" "$target"; then',
        '  /usr/bin/xattr -cr "$target" 2>/dev/null',
        '  # Only re-sign a signature macOS no longer accepts: a blanket ad-hoc',
        '  # re-sign would throw away a real Developer ID one.',
        '  if ! /usr/bin/codesign --verify --deep --strict "$target" >/dev/null 2>&1; then',
        '    /usr/bin/codesign --force --deep --sign - "$target"',
        '  fi',
        '  /bin/rm -rf "$backup"',
        'else',
        '  # Put the working copy back rather than leaving no app at all.',
        '  /bin/rm -rf "$target"',
        '  /bin/mv "$backup" "$target"',
        '  exit 1',
        'fi',
        '',
        'if [ "$relaunch" = "1" ]; then',
        '  /usr/bin/open "$target"',
        'fi',
        '',
        '/bin/rm -rf "$(dirname "$staged")"',
        '',
      ].join('\n'),
      'utf8'
    )

    await chmod(scriptPath, 0o755)

    return scriptPath
  }

  /**
   * Installs a staged update as the app shuts down, without reopening it.
   *
   * This is what makes updates land without the user having to click anything:
   * they quit the app as usual and the next launch is the new version.
   *
   * macOS only. On Windows the installer takes over the screen and relaunches
   * the app on its own, which is no way to treat someone who just quit.
   */
  public installOnQuit(): void {
    if (process.platform !== 'darwin') {
      return
    }

    this.install(false)
  }

  /**
   * Deletes anything a previous run left behind.
   *
   * Payloads run to hundreds of megabytes, and the install script can't delete
   * the directory it's being read from. Nothing is ever staged this early in a
   * launch, so whatever is in there is finished with.
   */
  public async cleanUpPreviousDownloads(): Promise<void> {
    await rm(this.workingDirectory, { recursive: true, force: true }).catch(e =>
      log.warn('[GitHubUpdater] could not clean up the update directory', e)
    )
  }
}
