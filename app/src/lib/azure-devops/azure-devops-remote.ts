/**
 * Pure helpers for Azure DevOps URLs. Kept free of storage and network
 * dependencies so they can be unit tested without a credential store around.
 */

/** What the parts of an Azure DevOps remote URL point at. */
export interface IAzureDevOpsRemote {
  readonly organization: string
  readonly project: string | null
  readonly repository: string | null
}

/**
 * Normalizes whatever the user typed into an organization name.
 *
 * People paste the URL of their organization as often as they type its name,
 * so accept `https://dev.azure.com/org`, `org.visualstudio.com`, and a bare
 * `org`, with or without trailing paths.
 */
export function normalizeAzureDevOpsOrganization(
  input: string
): string | null {
  const trimmed = input.trim()

  if (trimmed === '') {
    return null
  }

  // A bare name never has a dot or a slash; anything else is treated as a URL.
  if (/^[a-z0-9][a-z0-9-]*$/i.test(trimmed)) {
    return trimmed
  }

  const withScheme = /^[a-z]+:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  let url: URL

  try {
    url = new URL(withScheme)
  } catch {
    return null
  }

  const host = url.hostname.toLowerCase()

  if (host === 'dev.azure.com') {
    const [organization] = url.pathname.split('/').filter(s => s !== '')
    return organization ? decodeURIComponent(organization) : null
  }

  const legacy = /^([^.]+)\.visualstudio\.com$/.exec(host)

  return legacy === null ? null : legacy[1]
}

/**
 * Picks the organization, project and repository out of a remote URL.
 *
 * Handles the shapes Azure DevOps hands out today and the ones older projects
 * still carry around:
 *
 *   https://dev.azure.com/org/project/_git/repo
 *   https://org@dev.azure.com/org/project/_git/repo
 *   https://org.visualstudio.com/project/_git/repo
 *   https://org.visualstudio.com/DefaultCollection/project/_git/repo
 *   git@ssh.dev.azure.com:v3/org/project/repo
 *
 * A URL for the organization alone (which is what git sends when it isn't
 * including the path) resolves with a null project and repository.
 */
export function parseAzureDevOpsRemote(url: string): IAzureDevOpsRemote | null {
  const ssh =
    /^(?:ssh:\/\/)?git@ssh\.dev\.azure\.com[:/]v3\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(
      url.trim()
    )

  if (ssh !== null) {
    return {
      organization: decodeURIComponent(ssh[1]),
      project: decodeURIComponent(ssh[2]),
      repository: decodeURIComponent(ssh[3]),
    }
  }

  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const host = parsed.hostname.toLowerCase()
  const segments = parsed.pathname
    .split('/')
    .filter(s => s !== '')
    .map(decodeURIComponent)

  let organization: string | null = null
  let rest: ReadonlyArray<string> = []

  if (host === 'dev.azure.com') {
    organization = segments[0] ?? null
    rest = segments.slice(1)
  } else {
    const legacy = /^([^.]+)\.visualstudio\.com$/.exec(host)

    if (legacy === null) {
      return null
    }

    organization = legacy[1]
    rest =
      segments[0]?.toLowerCase() === 'defaultcollection'
        ? segments.slice(1)
        : segments
  }

  if (organization === null || organization === '') {
    return null
  }

  const gitIndex = rest.findIndex(s => s.toLowerCase() === '_git')
  const project = gitIndex > 0 ? rest[gitIndex - 1] : null
  const repository =
    gitIndex >= 0 && rest[gitIndex + 1] !== undefined
      ? rest[gitIndex + 1].replace(/\.git$/i, '')
      : null

  return { organization, project, repository }
}

/** Whether a remote URL points at Azure DevOps at all. */
export function isAzureDevOpsRemote(url: string): boolean {
  return parseAzureDevOpsRemote(url) !== null
}
