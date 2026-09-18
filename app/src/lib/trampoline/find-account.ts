import memoizeOne from 'memoize-one'
import { getHTMLURL } from '../api'
import { getGenericPassword, getGenericUsername } from '../generic-git-auth'
import { AccountsStore } from '../stores'
import { urlWithoutCredentials } from './url-without-credentials'
import { Account } from '../../models/account'
import {
  getAzureDevOpsCredential,
  getAzureDevOpsOrganizations,
  parseAzureDevOpsRemote,
} from '../azure-devops/azure-devops'

/**
 * When we're asked for credentials we're typically first asked for the username
 * immediately followed by the password. We memoize the getGenericPassword call
 * such that we only call it once per endpoint/login pair. Since we include the
 * trampoline token in the invalidation key we'll only call it once per
 * trampoline session.
 */
const memoizedGetGenericPassword = memoizeOne(
  (_trampolineToken: string, endpoint: string, login: string) =>
    getGenericPassword(endpoint, login)
)

export async function findGitHubTrampolineAccount(
  accountsStore: AccountsStore,
  remoteUrl: string
): Promise<Account | undefined> {
  const accounts = await accountsStore.getAll()
  const parsedUrl = new URL(remoteUrl)
  return accounts.find(
    a => new URL(getHTMLURL(a.endpoint)).origin === parsedUrl.origin
  )
}

export async function findGenericTrampolineAccount(
  trampolineToken: string,
  remoteUrl: string
) {
  const parsedUrl = new URL(remoteUrl)
  const endpoint = urlWithoutCredentials(remoteUrl)

  const login =
    parsedUrl.username === ''
      ? getGenericUsername(endpoint)
      : parsedUrl.username

  if (login) {
    const token = await memoizedGetGenericPassword(
      trampolineToken,
      endpoint,
      login
    )

    if (token) {
      return { login, endpoint, token }
    }
  }

  // Nothing stored for this exact URL. If it's an Azure DevOps repository and
  // the user connected its organization, use the organization's PAT: it covers
  // every repository under it, including ones cloned before the organization
  // was added or outside the app altogether.
  const azure = await findAzureDevOpsTrampolineAccount(endpoint)

  if (azure) {
    return azure
  }

  if (login) {
    // We have a username but no password, that warrants a warning
    log.warn(`credential: generic password for ${remoteUrl} missing`)
  }

  return undefined
}

/**
 * The organization-level Azure DevOps credential for a repository URL.
 *
 * Git normally includes the path when asking for dev.azure.com credentials, so
 * the organization is the first path segment. When it doesn't - a bare
 * https://dev.azure.com - the only case we can answer is a user with a single
 * connected organization; with several there's no telling which one git wants.
 */
async function findAzureDevOpsTrampolineAccount(endpoint: string) {
  const remote = parseAzureDevOpsRemote(endpoint)
  const bareHost = new URL(endpoint).hostname.toLowerCase() === 'dev.azure.com'

  if (remote === null && !bareHost) {
    return undefined
  }

  const organizations = getAzureDevOpsOrganizations()
  const organization =
    remote !== null
      ? organizations.find(
          o => o.name.toLowerCase() === remote.organization.toLowerCase()
        )
      : organizations.length === 1
      ? organizations[0]
      : undefined

  if (organization === undefined) {
    return undefined
  }

  const credential = await getAzureDevOpsCredential(organization.name)

  if (credential === null) {
    log.warn(
      `credential: Azure DevOps organization ${organization.name} is connected but its PAT is missing`
    )
    return undefined
  }

  log.info(
    `credential: using the Azure DevOps organization credential for ${organization.name}`
  )

  return { login: credential.username, endpoint, token: credential.pat }
}
