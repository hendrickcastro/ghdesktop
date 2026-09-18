import * as React from 'react'
import { Row } from '../lib/row'
import { Button } from '../lib/button'
import { TextBox } from '../lib/text-box'
import { LinkButton } from '../lib/link-button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import {
  IAzureDevOpsOrganization,
  getAzureDevOpsOrganizations,
  normalizeAzureDevOpsOrganization,
  removeAzureDevOpsOrganization,
  saveAzureDevOpsOrganization,
  testAzureDevOpsConnection,
} from '../../lib/azure-devops/azure-devops'

type FormState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'success'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string }

interface IAzureDevOpsAccountsState {
  readonly organizations: ReadonlyArray<IAzureDevOpsOrganization>
  /** Whether the "add organization" form is open. */
  readonly adding: boolean
  readonly organization: string
  readonly username: string
  readonly pat: string
  readonly formState: FormState
}

/**
 * The Azure DevOps section of the Accounts pane.
 *
 * There's no OAuth flow to lean on here: Azure DevOps wants a personal access
 * token, and the PAT belongs to one organization at a time. So this is a form,
 * and an organization is "signed in" when its PAT has been checked against the
 * API and stored.
 *
 * Saves take effect immediately, like GitHub sign-in does, rather than waiting
 * on the dialog's Save button.
 */
export class AzureDevOpsAccounts extends React.Component<
  {},
  IAzureDevOpsAccountsState
> {
  public constructor(props: {}) {
    super(props)

    const organizations = getAzureDevOpsOrganizations()

    this.state = {
      organizations,
      adding: organizations.length === 0,
      organization: '',
      username: '',
      pat: '',
      formState: { kind: 'idle' },
    }
  }

  private onOrganizationChanged = (organization: string) =>
    this.setState({ organization, formState: { kind: 'idle' } })

  private onUsernameChanged = (username: string) =>
    this.setState({ username, formState: { kind: 'idle' } })

  private onPATChanged = (pat: string) =>
    this.setState({ pat, formState: { kind: 'idle' } })

  private onStartAdding = () =>
    this.setState({ adding: true, formState: { kind: 'idle' } })

  private onCancelAdding = () =>
    this.setState({
      adding: false,
      organization: '',
      username: '',
      pat: '',
      formState: { kind: 'idle' },
    })

  private onSave = async () => {
    const organization = normalizeAzureDevOpsOrganization(
      this.state.organization
    )
    const username = this.state.username.trim()
    const pat = this.state.pat.trim()

    if (organization === null) {
      this.setState({
        formState: {
          kind: 'error',
          message:
            'Enter the organization name, or paste its URL (https://dev.azure.com/your-org).',
        },
      })
      return
    }

    if (username === '' || pat === '') {
      this.setState({
        formState: {
          kind: 'error',
          message: 'Both the username and the personal access token are needed.',
        },
      })
      return
    }

    this.setState({ formState: { kind: 'busy' } })

    try {
      // Check before storing: a PAT that can't read the organization would
      // otherwise sit in the credential store failing every fetch and push.
      const projects = await testAzureDevOpsConnection(
        organization,
        username,
        pat
      )

      await saveAzureDevOpsOrganization(organization, username, pat)

      this.setState({
        organizations: getAzureDevOpsOrganizations(),
        adding: false,
        organization: '',
        username: '',
        pat: '',
        formState: {
          kind: 'success',
          message: `Connected to ${organization} — the PAT can see ${projects} team ${
            projects === 1 ? 'project' : 'projects'
          }.`,
        },
      })
    } catch (e) {
      this.setState({
        formState: { kind: 'error', message: (e as Error).message },
      })
    }
  }

  private onRemove = (organization: IAzureDevOpsOrganization) => async () => {
    await removeAzureDevOpsOrganization(organization.name)

    this.setState({
      organizations: getAzureDevOpsOrganizations(),
      formState: { kind: 'idle' },
    })
  }

  public render() {
    const { organizations, adding } = this.state

    return (
      <>
        {organizations.map(this.renderOrganization)}

        {adding ? (
          this.renderForm()
        ) : (
          <Button onClick={this.onStartAdding}>
            Add Azure DevOps organization
          </Button>
        )}

        {this.renderFormState()}
      </>
    )
  }

  private renderOrganization = (organization: IAzureDevOpsOrganization) => (
    <Row className="account-info" key={organization.name}>
      <div className="user-info-container">
        <Octicon className="azure-devops-icon" symbol={octicons.organization} />
        <div className="user-info">
          <div className="account-title">{organization.name}</div>
          <div className="endpoint">
            https://dev.azure.com/{organization.name} · {organization.username}
          </div>
        </div>
      </div>
      <Button onClick={this.onRemove(organization)}>Remove</Button>
    </Row>
  )

  private renderForm() {
    const busy = this.state.formState.kind === 'busy'

    return (
      <div className="azure-devops-form">
        <TextBox
          label="Organization"
          value={this.state.organization}
          placeholder="your-org, or https://dev.azure.com/your-org"
          onValueChanged={this.onOrganizationChanged}
          disabled={busy}
        />
        <TextBox
          label="Username"
          value={this.state.username}
          placeholder="you@example.com"
          onValueChanged={this.onUsernameChanged}
          disabled={busy}
        />
        <TextBox
          label="Personal access token"
          type="password"
          value={this.state.pat}
          placeholder="Paste the PAT"
          onValueChanged={this.onPATChanged}
          onEnterPressed={this.onSave}
          disabled={busy}
        />
        <p className="git-settings-description">
          The token needs <strong>Code (Read &amp; Write)</strong> scope to
          clone, fetch and push. Create one under User settings › Personal
          access tokens in your organization, or read{' '}
          <LinkButton uri="https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate">
            how PATs work
          </LinkButton>
          . It is stored in the OS credential manager and used for every
          repository in the organization.
        </p>
        <Row>
          <Button type="submit" onClick={this.onSave} disabled={busy}>
            {busy ? 'Checking…' : 'Test and add'}
          </Button>
          {this.state.organizations.length > 0 && (
            <Button onClick={this.onCancelAdding} disabled={busy}>
              Cancel
            </Button>
          )}
        </Row>
      </div>
    )
  }

  private renderFormState() {
    const { formState } = this.state

    if (formState.kind === 'success') {
      return <p className="git-settings-description">{formState.message}</p>
    }

    if (formState.kind === 'error') {
      return (
        <div className="setting-hint-warning">
          <span className="warning-icon">⚠️</span> {formState.message}
        </div>
      )
    }

    return null
  }
}
