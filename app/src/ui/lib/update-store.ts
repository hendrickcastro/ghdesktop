const lastSuccessfulCheckKey = 'last-successful-update-check'

import { Emitter, Disposable } from 'event-kit'

import {
  checkForGitHubUpdates,
  checkForUpdates,
  isRunningUnderARM64Translation,
  onAutoUpdaterCheckingForUpdate,
  onAutoUpdaterError,
  onAutoUpdaterUpdateAvailable,
  onAutoUpdaterUpdateDownloaded,
  onAutoUpdaterUpdateNotAvailable,
  onGitHubUpdateDownloadProgress,
  onGitHubUpdateStaged,
  quitAndInstallUpdate,
  sendWillQuitSync,
} from '../main-process-proxy'
import {
  IGitHubUpdate,
  IUpdateDownloadProgress,
} from '../../lib/updates/github-release'
import { ErrorWithMetadata } from '../../lib/error-with-metadata'
import { parseError } from '../../lib/squirrel-error-parser'

import { ReleaseSummary } from '../../models/release-notes'
import { generateReleaseSummary } from '../../lib/release-notes'
import { setNumber, getNumber } from '../../lib/local-storage'
import { enableUpdateFromEmulatedX64ToARM64 } from '../../lib/feature-flag'
import { offsetFromNow } from '../../lib/offset-from'
import { gte, SemVer } from 'semver'
import { getVersion } from './app-proxy'
import { getUserAgent } from '../../lib/http'

/** The last version a showcase was seen. */
export const lastShowCaseVersionSeen = 'version-of-last-showcase'

/** The states the auto updater can be in. */
export enum UpdateStatus {
  /** The auto updater is checking for updates. */
  CheckingForUpdates,

  /** An update is available and will begin downloading. */
  UpdateAvailable,

  /** No update is available. */
  UpdateNotAvailable,

  /** An update has been downloaded and is ready to be installed. */
  UpdateReady,

  /** We have not checked for an update yet. */
  UpdateNotChecked,
}

export interface IUpdateState {
  status: UpdateStatus
  lastSuccessfulCheck: Date | null
  isX64ToARM64ImmediateAutoUpdate: boolean
  newReleases: ReadonlyArray<ReleaseSummary> | null
  prioritizeUpdate: boolean
  prioritizeUpdateInfoUrl: string | undefined
  /**
   * The release downloaded from the fork's GitHub releases, once there is one.
   * Null on the Squirrel path, which doesn't say what it downloaded.
   */
  pendingUpdate: IGitHubUpdate | null
  /** How far along the current download is, while one is running. */
  downloadProgress: IUpdateDownloadProgress | null
}

/**
 * Whether updates come from the fork's GitHub releases rather than Squirrel.
 *
 * Mirrors isGitHubUpdaterEnabled in the main process: a Squirrel feed wins when
 * a build has one.
 */
export function isGitHubUpdateMode(): boolean {
  return __UPDATES_GITHUB_REPO__ !== '' && __UPDATES_URL__ === ''
}

/** A store which contains the current state of the auto updater. */
class UpdateStore {
  private emitter = new Emitter()
  private status = UpdateStatus.UpdateNotChecked
  private lastSuccessfulCheck: Date | null = null
  private newReleases: ReadonlyArray<ReleaseSummary> | null = null
  private isX64ToARM64ImmediateAutoUpdate: boolean = false

  /** Is the most recent update check user initiated? */
  private userInitiatedUpdate = true
  private _prioritizeUpdate = false
  private _prioritizeUpdateInfoUrl: string | undefined = undefined
  private pendingUpdate: IGitHubUpdate | null = null
  private downloadProgress: IUpdateDownloadProgress | null = null

  public get prioritizeUpdate() {
    return this._prioritizeUpdate
  }

  public get prioritizeUpdateInfoUrl() {
    return this._prioritizeUpdateInfoUrl
  }

  public constructor() {
    const lastSuccessfulCheckTime = getNumber(lastSuccessfulCheckKey, 0)

    if (lastSuccessfulCheckTime > 0) {
      this.lastSuccessfulCheck = new Date(lastSuccessfulCheckTime)
    }

    onAutoUpdaterError(this.onAutoUpdaterError)
    onAutoUpdaterCheckingForUpdate(this.onCheckingForUpdate)
    onAutoUpdaterUpdateAvailable(this.onUpdateAvailable)
    onAutoUpdaterUpdateNotAvailable(this.onUpdateNotAvailable)
    onAutoUpdaterUpdateDownloaded(this.onUpdateDownloaded)
    onGitHubUpdateStaged(this.onGitHubUpdateStaged)
    onGitHubUpdateDownloadProgress(this.onGitHubDownloadProgress)
  }

  /** Arrives just before the update-downloaded event, naming the release. */
  private onGitHubUpdateStaged = (
    _: Electron.IpcRendererEvent,
    update: IGitHubUpdate
  ) => {
    this.pendingUpdate = update
  }

  private onGitHubDownloadProgress = (
    _: Electron.IpcRendererEvent,
    progress: IUpdateDownloadProgress
  ) => {
    this.downloadProgress = progress
    this.emitDidChange()
  }

  private touchLastChecked() {
    const now = new Date()
    this.lastSuccessfulCheck = now
    setNumber(lastSuccessfulCheckKey, now.getTime())
  }

  private onAutoUpdaterError = (e: Electron.IpcRendererEvent, error: Error) => {
    this.status = UpdateStatus.UpdateNotAvailable

    if (__WIN32__) {
      const parsedError = parseError(error)
      this.emitError(parsedError || error)
    } else {
      this.emitError(error)
    }
  }

  private onCheckingForUpdate = () => {
    this.status = UpdateStatus.CheckingForUpdates
    this.emitDidChange()
  }

  private onUpdateAvailable = () => {
    this.touchLastChecked()
    this.status = UpdateStatus.UpdateAvailable
    this.emitDidChange()
  }

  private onUpdateNotAvailable = async () => {
    // This is so we can check for pretext changelog for showcasing a recent
    // update. Skipped on the GitHub path: that changelog is upstream's, so it
    // describes releases this fork never shipped.
    if (!isGitHubUpdateMode()) {
      this.newReleases = await generateReleaseSummary()
    }

    this.downloadProgress = null
    this.touchLastChecked()
    this.status = UpdateStatus.UpdateNotAvailable
    this.emitDidChange()
  }

  private onUpdateDownloaded = async () => {
    this.downloadProgress = null

    if (isGitHubUpdateMode()) {
      // The release's own notes live on github.com, which the UI links to via
      // pendingUpdate rather than rendering them in the release notes popup.
      this.touchLastChecked()
      this.status = UpdateStatus.UpdateReady
      this.emitDidChange()
      return
    }

    this.newReleases = await generateReleaseSummary()
    // We know it's an "immediate" auto-update from x64 to arm64 if the app is
    // running on arm64 under x64 emulation and there is only one new release
    // and it's the same version we have right now (which means we spoofed
    // Central with an old version of the app).
    this.isX64ToARM64ImmediateAutoUpdate =
      this.supportsImmediateUpdateFromEmulatedX64ToARM64() &&
      this.newReleases !== null &&
      this.newReleases.length === 1 &&
      this.newReleases[0].latestVersion === getVersion() &&
      (await isRunningUnderARM64Translation())
    this.status = UpdateStatus.UpdateReady
    this.emitDidChange()

    this.updatePriorityUpdateStatus()
  }

  /**
   * Whether or not the app supports auto-updating x64 apps running under ARM
   * translation to ARM64 builds IMMEDIATELY instead of waiting for the next
   * release.
   */
  private supportsImmediateUpdateFromEmulatedX64ToARM64(): boolean {
    // Because of how Squirrel.Windows works, this is only available for macOS.
    // See: https://github.com/desktop/desktop/pull/14998
    return __DARWIN__
  }

  /** Register a function to call when the auto updater state changes. */
  public onDidChange(fn: (state: IUpdateState) => void): Disposable {
    return this.emitter.on('did-change', fn)
  }

  private emitDidChange() {
    this.emitter.emit('did-change', this.state)
  }

  /** Register a function to call when the auto updater encounters an error. */
  public onError(fn: (error: Error) => void): Disposable {
    return this.emitter.on('error', fn)
  }

  private emitError(error: Error) {
    const updatedError = new ErrorWithMetadata(error, {
      backgroundTask: !this.userInitiatedUpdate,
    })
    this.emitter.emit('error', updatedError)
  }

  /** The current auto updater state. */
  public get state(): IUpdateState {
    return {
      status: this.status,
      lastSuccessfulCheck: this.lastSuccessfulCheck,
      newReleases: this.newReleases,
      isX64ToARM64ImmediateAutoUpdate: this.isX64ToARM64ImmediateAutoUpdate,
      prioritizeUpdate: this.prioritizeUpdate,
      prioritizeUpdateInfoUrl: this.prioritizeUpdateInfoUrl,
      pendingUpdate: this.pendingUpdate,
      downloadProgress: this.downloadProgress,
    }
  }

  /**
   * Check for updates.
   *
   * @param inBackground  - Are we checking for updates in the background, or was
   *                       this check user-initiated?
   * @param skipGuidCheck - If true, don't check the GUID. If true, this will
   *                       effectively disable the staggered releases system and
   *                       attempt to retrieve the latest available deployment.
   */
  public async checkForUpdates(inBackground: boolean, skipGuidCheck: boolean) {
    // An update has been downloaded and the app is waiting to be restarted.
    // Checking for updates again may result in the running app being nuked
    // when it finds a subsequent update on Windows, or the "Quit and Update"
    // button to crash the app if in the subsequent check, there is no update
    // available anymore due to a disabled update.
    if (this.status === UpdateStatus.UpdateReady) {
      this.updatePriorityUpdateStatus()
      return
    }

    this.userInitiatedUpdate = !inBackground

    if (isGitHubUpdateMode()) {
      const error = await checkForGitHubUpdates()

      if (error !== undefined) {
        this.emitError(error)
      }

      return
    }

    const updatesUrl = await this.getUpdatesUrl(skipGuidCheck)

    if (updatesUrl === null) {
      return
    }

    const error = await checkForUpdates(updatesUrl)

    if (error !== undefined) {
      this.emitError(error)
    }
  }

  private async getUpdatesUrl(skipGuidCheck: boolean) {
    // An empty updates URL means this build has no Squirrel feed to check - it
    // updates from the fork's GitHub releases instead, which checkForUpdates
    // routes to before it gets here. See areUpdatesDisabled in
    // script/dist-info.ts for why we don't fall back to upstream's feed.
    if (__UPDATES_URL__ === '') {
      return null
    }

    let url = null

    try {
      url = new URL(__UPDATES_URL__)
    } catch (e) {
      log.error('Error parsing updates url', e)
      return __UPDATES_URL__
    }

    if (skipGuidCheck) {
      // This will effectively disable the staggered releases system and attempt
      // to retrieve the latest available deployment.
      url.searchParams.set('skipGuidCheck', '1')
    }

    // If the app is running under arm64 to x64 translation, we need to tweak the
    // update URL here to point at the arm64 binary.
    if (
      enableUpdateFromEmulatedX64ToARM64() &&
      (await isRunningUnderARM64Translation()) === true
    ) {
      url.pathname = url.pathname.replace(
        /\/desktop\/desktop\/(x64\/)?latest/,
        '/desktop/desktop/arm64/latest'
      )

      // If we want the app to force an auto-update from x64 to arm64 right
      // after being installed, we need to spoof a really old version to trick
      // both Central and Squirrel into thinking we need the update.
      if (this.supportsImmediateUpdateFromEmulatedX64ToARM64()) {
        url.searchParams.set('version', '0.0.64')
      }
    }

    return url.toString()
  }

  /** Quit and install the update. */
  public quitAndInstallUpdate() {
    // This is synchronous so that we can ensure the app will let itself be quit
    // before we call the function to quit.
    // eslint-disable-next-line no-sync
    sendWillQuitSync()
    quitAndInstallUpdate()
  }

  private async updatePriorityUpdateStatus() {
    const updatesUrl = await this.getUpdatesUrl(false)

    if (updatesUrl === null) {
      return
    }

    try {
      const response = await fetch(updatesUrl, {
        method: 'HEAD',
        headers: { 'user-agent': getUserAgent() },
      })

      const prioritizeUpdate =
        response.headers.get('x-prioritize-update') === 'true'

      const prioritizeUpdateInfoUrl =
        response.headers.get('x-prioritize-update-info-url') ?? undefined

      if (
        this._prioritizeUpdate !== prioritizeUpdate ||
        this._prioritizeUpdateInfoUrl !== prioritizeUpdateInfoUrl
      ) {
        this._prioritizeUpdate = prioritizeUpdate
        this._prioritizeUpdateInfoUrl = prioritizeUpdateInfoUrl
        this.emitDidChange()
      }
    } catch (e) {
      log.error('Error updating priority update status', e)
    }
  }

  /**
   * Method to determine if we should show an update showcase call to action.
   *
   * @returns true if there is a pretext on the latest releases and that release
   * was published in the last 15 days.
   */
  public async isUpdateShowcase() {
    // The showcase is driven by upstream's changelog, which says nothing about
    // this fork's releases.
    if (isGitHubUpdateMode()) {
      return false
    }

    if (
      (__RELEASE_CHANNEL__ === 'development' ||
        __RELEASE_CHANNEL__ === 'test') &&
      this.newReleases === null &&
      this.status === UpdateStatus.UpdateNotChecked
    ) {
      // On prod or with test manual check for updates, we are doing this during
      // the automatic check for updates
      this.newReleases = await generateReleaseSummary()
    }

    if (this.newReleases === null) {
      return false
    }

    const lastShowCaseVersion = localStorage.getItem(lastShowCaseVersionSeen)
    if (lastShowCaseVersion !== null) {
      const lastShowCaseSemVersion = new SemVer(lastShowCaseVersion)
      const latestRelease = new SemVer(this.newReleases[0].latestVersion)
      if (gte(lastShowCaseSemVersion, latestRelease)) {
        return false
      }
    }

    return this.newReleases
      .filter(
        r => new Date(r.datePublished).getTime() > offsetFromNow(-15, 'days')
      )
      .some(r => r.pretext.length > 0)
  }

  /** This method has only been added for ease of testing the update banner in
   * this state and as such is limite to dev and test environments */
  public setIsx64ToARM64ImmediateAutoUpdate(value: boolean) {
    if (
      __RELEASE_CHANNEL__ !== 'development' &&
      __RELEASE_CHANNEL__ !== 'test'
    ) {
      return
    }

    this.isX64ToARM64ImmediateAutoUpdate = value
  }

  /** This method has only been added for ease of testing the update banner in
   * this state and as such is limite to dev and test environments */
  public setPrioritizeUpdate(value: boolean) {
    if (
      __RELEASE_CHANNEL__ !== 'development' &&
      __RELEASE_CHANNEL__ !== 'test'
    ) {
      return
    }

    this._prioritizeUpdate = value
  }

  /** This method has only been added for ease of testing the update banner in
   * this state and as such is limite to dev and test environments */
  public setPrioritizeUpdateInfoUrl(value: string | undefined) {
    if (
      __RELEASE_CHANNEL__ !== 'development' &&
      __RELEASE_CHANNEL__ !== 'test'
    ) {
      return
    }

    this._prioritizeUpdateInfoUrl = value
  }
}

/** The store which contains the current state of the auto updater. */
export const updateStore = new UpdateStore()
