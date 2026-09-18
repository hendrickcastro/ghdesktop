import { getObject, setObject } from '../local-storage'
import {
  deleteGenericCredential,
  getGenericPassword,
  getGenericUsername,
  setGenericCredential,
} from '../generic-git-auth'

export {
  IAzureDevOpsRemote,
  isAzureDevOpsRemote,
  normalizeAzureDevOpsOrganization,
  parseAzureDevOpsRemote,
} from './azure-devops-remote'

/**
 * An Azure DevOps organization the user has connected, minus the PAT, which
 * lives in the credential store as a generic git credential for the
 * organization's endpoint - see getAzureDevOpsEndpoint.
 */
export interface IAzureDevOpsOrganization {
  /** The organization name as it appears in https://dev.azure.com/<name>. */
  readonly name: string
  /** The user the PAT belongs to; Basic auth needs both halves. */
  readonly username: string
}

/** A git repository as reported by the Azure DevOps REST API. */
export interface IAzureDevOpsRepository {
  readonly organization: string
  /** The team project the repository belongs to. */
  readonly project: string
  readonly name: string
  /** The HTTPS URL to clone from, with no credentials embedded. */
  readonly cloneUrl: string
  /** The repository's page on dev.azure.com. */
  readonly webUrl: string
  /** Default branch name without the refs/heads/ prefix, or null when unset. */
  readonly defaultBranch: string | null
}

const OrganizationsKey = 'azureDevOpsOrganizations'

const ApiVersion = '7.1'

/**
 * The endpoint an organization's credential is stored under.
 *
 * Kept as a plain URL so the trampoline can fall back to it for any repository
 * under the organization - git asks for credentials per repository URL, and
 * there's no telling in advance which repositories the user will clone.
 */
export function getAzureDevOpsEndpoint(organization: string): string {
  return `https://dev.azure.com/${encodeURIComponent(organization)}`
}

/** Every organization the user has connected, in the order they were added. */
export function getAzureDevOpsOrganizations(): ReadonlyArray<IAzureDevOpsOrganization> {
  const stored = getObject<ReadonlyArray<IAzureDevOpsOrganization>>(
    OrganizationsKey
  )

  return Array.isArray(stored)
    ? stored.filter(
        o => typeof o?.name === 'string' && typeof o?.username === 'string'
      )
    : []
}

function findOrganization(
  name: string
): IAzureDevOpsOrganization | undefined {
  const lower = name.toLowerCase()
  return getAzureDevOpsOrganizations().find(
    o => o.name.toLowerCase() === lower
  )
}

/**
 * Connects an organization, replacing an existing entry for the same name.
 *
 * The PAT goes to the OS credential store, never to local storage.
 */
export async function saveAzureDevOpsOrganization(
  name: string,
  username: string,
  pat: string
): Promise<void> {
  const endpoint = getAzureDevOpsEndpoint(name)
  const existing = findOrganization(name)

  // A different username for the same organization would leave the old PAT
  // orphaned in the credential store.
  if (existing !== undefined && existing.username !== username) {
    await deleteGenericCredential(endpoint, existing.username)
  }

  await setGenericCredential(endpoint, username, pat)

  const others = getAzureDevOpsOrganizations().filter(
    o => o.name.toLowerCase() !== name.toLowerCase()
  )

  setObject(OrganizationsKey, [...others, { name, username }])
}

export async function removeAzureDevOpsOrganization(
  name: string
): Promise<void> {
  const existing = findOrganization(name)

  if (existing !== undefined) {
    await deleteGenericCredential(
      getAzureDevOpsEndpoint(existing.name),
      existing.username
    )
  }

  setObject(
    OrganizationsKey,
    getAzureDevOpsOrganizations().filter(
      o => o.name.toLowerCase() !== name.toLowerCase()
    )
  )
}

/** The username and PAT for an organization, or null when it isn't connected. */
export async function getAzureDevOpsCredential(
  organization: string
): Promise<{ readonly username: string; readonly pat: string } | null> {
  const endpoint = getAzureDevOpsEndpoint(organization)
  const username =
    findOrganization(organization)?.username ?? getGenericUsername(endpoint)

  if (!username) {
    return null
  }

  const pat = await getGenericPassword(endpoint, username)

  return pat ? { username, pat } : null
}

function basicAuth(username: string, pat: string): string {
  return `Basic ${btoa(`${username}:${pat}`)}`
}

/**
 * Turns a failed API response into an error worth showing.
 *
 * Azure's failures come in two flavours: a JSON body with a "message" (an
 * expired PAT, a missing scope), or a 401 with nothing in it at all.
 */
async function failedRequestError(response: Response): Promise<Error> {
  let detail = ''

  try {
    const body = await response.text()

    try {
      detail = JSON.parse(body)?.message ?? ''
    } catch {
      detail = body.slice(0, 300)
    }
  } catch {
    // The status is enough on its own.
  }

  const denied = response.status === 401 || response.status === 403

  if (denied && detail.trim() === '') {
    detail = 'the PAT is invalid, has expired, or has no access to this organization'
  }

  return new Error(
    `Azure DevOps returned ${response.status}${
      detail === '' ? '' : `: ${detail}`
    }`
  )
}

async function apiGet<T>(url: string, authorization: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization, accept: 'application/json' },
  })

  if (!response.ok) {
    throw await failedRequestError(response)
  }

  // A rejected PAT doesn't produce a 401 here. It produces a 203 with the
  // sign-in page as HTML, which is "ok" as far as fetch is concerned and then
  // fails to parse as JSON with a message nobody could act on.
  if (!(response.headers.get('content-type') ?? '').includes('json')) {
    throw new Error(
      'Azure DevOps did not accept the PAT for this organization. Check that it is valid and has Code (Read) scope.'
    )
  }

  return response.json()
}

/**
 * Checks that a username and PAT can read the organization.
 *
 * @returns The number of team projects the PAT can see - a real answer from
 *          the API, so a success here means listing will work too.
 */
export async function testAzureDevOpsConnection(
  organization: string,
  username: string,
  pat: string
): Promise<number> {
  const body = await apiGet<{ count?: number; value?: unknown[] }>(
    `${getAzureDevOpsEndpoint(
      organization
    )}/_apis/projects?$top=1&api-version=${ApiVersion}`,
    basicAuth(username, pat)
  )

  return body.count ?? body.value?.length ?? 0
}

interface IProjectsPage {
  readonly value?: ReadonlyArray<{ readonly name?: unknown }>
}

/**
 * Every team project in the organization.
 *
 * Paged: the API caps a page at a few hundred projects and hands back the
 * continuation token in a header rather than the body.
 */
async function fetchProjects(
  organization: string,
  authorization: string
): Promise<ReadonlyArray<string>> {
  const names: string[] = []
  let continuationToken: string | null = null

  do {
    const url = new URL(
      `${getAzureDevOpsEndpoint(organization)}/_apis/projects`
    )
    url.searchParams.set('$top', '200')
    url.searchParams.set('api-version', ApiVersion)

    if (continuationToken !== null) {
      url.searchParams.set('continuationToken', continuationToken)
    }

    const response = await fetch(url.toString(), {
      headers: { authorization, accept: 'application/json' },
    })

    if (!response.ok) {
      throw await failedRequestError(response)
    }

    if (!(response.headers.get('content-type') ?? '').includes('json')) {
      throw new Error(
        'Azure DevOps did not accept the PAT for this organization. Check that it is valid and has Code (Read) scope.'
      )
    }

    const page: IProjectsPage = await response.json()

    for (const project of page.value ?? []) {
      if (typeof project.name === 'string') {
        names.push(project.name)
      }
    }

    continuationToken = response.headers.get('x-ms-continuationtoken')
  } while (continuationToken !== null && continuationToken !== '')

  return names
}

interface IRepositoriesResponse {
  readonly value?: ReadonlyArray<{
    readonly name?: unknown
    readonly webUrl?: unknown
    readonly defaultBranch?: unknown
    readonly isDisabled?: unknown
  }>
}

/**
 * Every git repository the PAT can see in the organization, across all of its
 * team projects.
 *
 * Azure DevOps has no single "list my repositories" call, so this walks the
 * projects and asks each one. Projects are fetched a few at a time: an
 * organization with dozens of them would otherwise take a while, but firing
 * them all at once trips the API's rate limiting.
 *
 * @throws If the organization isn't connected or the API refuses the request.
 */
export async function fetchAzureDevOpsRepositories(
  organization: string
): Promise<ReadonlyArray<IAzureDevOpsRepository>> {
  const credential = await getAzureDevOpsCredential(organization)

  if (credential === null) {
    throw new Error(
      `No credentials stored for the Azure DevOps organization ${organization}. Add it again in Preferences > Accounts.`
    )
  }

  const authorization = basicAuth(credential.username, credential.pat)
  const projects = await fetchProjects(organization, authorization)
  const repositories: IAzureDevOpsRepository[] = []

  const fetchProject = async (project: string) => {
    const body = await apiGet<IRepositoriesResponse>(
      `${getAzureDevOpsEndpoint(organization)}/${encodeURIComponent(
        project
      )}/_apis/git/repositories?api-version=${ApiVersion}`,
      authorization
    )

    for (const repo of body.value ?? []) {
      if (typeof repo.name !== 'string' || repo.isDisabled === true) {
        continue
      }

      const defaultBranch =
        typeof repo.defaultBranch === 'string'
          ? repo.defaultBranch.replace(/^refs\/heads\//, '')
          : null

      repositories.push({
        organization,
        project,
        name: repo.name,
        cloneUrl: `${getAzureDevOpsEndpoint(organization)}/${encodeURIComponent(
          project
        )}/_git/${encodeURIComponent(repo.name)}`,
        webUrl:
          typeof repo.webUrl === 'string'
            ? repo.webUrl
            : `${getAzureDevOpsEndpoint(organization)}/${encodeURIComponent(
                project
              )}/_git/${encodeURIComponent(repo.name)}`,
        defaultBranch: defaultBranch === '' ? null : defaultBranch,
      })
    }
  }

  const concurrency = 4
  const queue = [...projects]

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let project = queue.shift(); project !== undefined; project = queue.shift()) {
        await fetchProject(project)
      }
    })
  )

  return repositories.sort(
    (a, b) =>
      a.project.localeCompare(b.project, undefined, { sensitivity: 'base' }) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  )
}
