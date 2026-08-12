import { releasesUrl } from '../../lib/updates/github-release'

/**
 * Where to send someone who wants to read what changed.
 *
 * Builds that update from the fork's GitHub releases point at those releases -
 * upstream's release notes page describes vanilla GitHub Desktop, so it would
 * list versions this app has never run and omit everything it actually shipped.
 */
export const ReleaseNotesUri =
  __UPDATES_GITHUB_REPO__ !== ''
    ? releasesUrl(__UPDATES_GITHUB_REPO__)
    : __RELEASE_CHANNEL__ === 'beta'
    ? 'https://desktop.github.com/release-notes/?env=beta'
    : 'https://desktop.github.com/release-notes/'
