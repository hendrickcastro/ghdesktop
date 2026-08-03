import * as React from 'react'
import { DialogContent } from '../dialog'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { Select } from '../lib/select'
import { TextBox } from '../lib/text-box'
import { LinkButton } from '../lib/link-button'
import { Button } from '../lib/button'
import {
  IAIProviderConfig,
  formatTokenPrice,
  getAIProviderKeyLabel,
  getAIProviderKeyURL,
  getAIProviderModels,
  getAIProviderName,
  getAIProviderPricingURL,
  getDefaultAIBaseURL,
  getDefaultAIModel,
  parseAIProvider,
  supportedAIProviders,
} from '../../models/ai-provider'
import { verifyAIProvider } from '../../lib/ai/custom-ai-client'

interface IAIPreferencesProps {
  readonly aiProviderConfig: IAIProviderConfig
  /** The key as currently edited. Empty means "none stored". */
  readonly aiAPIKey: string
  readonly onAIProviderConfigChanged: (config: IAIProviderConfig) => void
  readonly onAIAPIKeyChanged: (key: string) => void
}

type TestState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'testing' }
  | { readonly kind: 'success' }
  | { readonly kind: 'error'; readonly message: string }

interface IAIPreferencesState {
  readonly testState: TestState
}

export class AI extends React.Component<
  IAIPreferencesProps,
  IAIPreferencesState
> {
  public constructor(props: IAIPreferencesProps) {
    super(props)
    this.state = { testState: { kind: 'idle' } }
  }

  private onEnabledChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.props.onAIProviderConfigChanged({
      ...this.props.aiProviderConfig,
      enabled: event.currentTarget.checked,
    })
  }

  private onProviderChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    const provider = parseAIProvider(event.currentTarget.value)

    if (provider === null) {
      return
    }

    // Model ids and endpoints are provider-specific, so carrying the previous
    // provider's values over would leave the config pointing at a model that
    // doesn't exist. Reset both to this provider's defaults.
    this.props.onAIProviderConfigChanged({
      ...this.props.aiProviderConfig,
      provider,
      model: '',
      baseURL: '',
    })
    this.props.onAIAPIKeyChanged('')
    this.setState({ testState: { kind: 'idle' } })
  }

  private onModelChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    this.props.onAIProviderConfigChanged({
      ...this.props.aiProviderConfig,
      model: event.currentTarget.value,
    })
  }

  private onBaseURLChanged = (baseURL: string) => {
    this.props.onAIProviderConfigChanged({
      ...this.props.aiProviderConfig,
      baseURL,
    })
  }

  private onAPIKeyChanged = (key: string) => {
    this.props.onAIAPIKeyChanged(key)
    this.setState({ testState: { kind: 'idle' } })
  }

  private onTestConnection = async () => {
    this.setState({ testState: { kind: 'testing' } })

    try {
      // Pass the in-flight key so the user can validate before saving.
      await verifyAIProvider(this.props.aiProviderConfig, this.props.aiAPIKey)
      this.setState({ testState: { kind: 'success' } })
    } catch (e) {
      this.setState({
        testState: { kind: 'error', message: (e as Error).message },
      })
    }
  }

  public render() {
    const { aiProviderConfig: config } = this.props

    return (
      <DialogContent>
        <div className="advanced-section">
          <h2>AI provider</h2>
          <Checkbox
            label="Use my own AI provider"
            value={config.enabled ? CheckboxValue.On : CheckboxValue.Off}
            onChange={this.onEnabledChanged}
          />
          <p className="git-settings-description">
            Generates commit messages through the provider you configure here
            instead of GitHub Copilot, so the feature works without a Copilot
            subscription. Your API key is stored in the operating system's
            credential manager, never in a settings file.
          </p>
        </div>

        {config.enabled ? this.renderProviderSettings() : null}
      </DialogContent>
    )
  }

  private renderProviderSettings() {
    const { aiProviderConfig: config, aiAPIKey } = this.props
    const models = getAIProviderModels(config.provider)
    const selectedModel =
      config.model === '' ? getDefaultAIModel(config.provider) : config.model

    return (
      <>
        <div className="advanced-section">
          <Select
            label="Provider"
            value={config.provider}
            onChange={this.onProviderChanged}
          >
            {supportedAIProviders.map(provider => (
              <option key={provider} value={provider}>
                {getAIProviderName(provider)}
              </option>
            ))}
          </Select>

          <TextBox
            label={getAIProviderKeyLabel(config.provider)}
            type="password"
            value={aiAPIKey}
            placeholder="Paste your key"
            onValueChanged={this.onAPIKeyChanged}
          />
          <p className="git-settings-description">
            Create one at{' '}
            <LinkButton uri={getAIProviderKeyURL(config.provider)}>
              {getAIProviderName(config.provider)}
            </LinkButton>
            .
          </p>
        </div>

        <div className="advanced-section">
          <Select
            label="Model"
            value={selectedModel}
            onChange={this.onModelChanged}
          >
            {models.map(model => (
              <option key={model.id} value={model.id}>
                {model.label} — {formatTokenPrice(model.inputPrice)} in /{' '}
                {formatTokenPrice(model.outputPrice)} out
              </option>
            ))}
          </Select>

          {this.renderPricingTable()}
        </div>

        <div className="advanced-section">
          <TextBox
            label="Endpoint (optional)"
            value={config.baseURL}
            placeholder={getDefaultAIBaseURL(config.provider)}
            onValueChanged={this.onBaseURLChanged}
          />
          <p className="git-settings-description">
            Leave empty to use the provider's own endpoint. Set this to reach a
            proxy or a self-hosted, compatible service.
          </p>
        </div>

        <div className="advanced-section">
          <Button
            onClick={this.onTestConnection}
            disabled={
              aiAPIKey === '' || this.state.testState.kind === 'testing'
            }
          >
            {this.state.testState.kind === 'testing'
              ? 'Testing…'
              : 'Test connection'}
          </Button>
          {this.renderTestResult()}
        </div>
      </>
    )
  }

  private renderPricingTable() {
    const { provider } = this.props.aiProviderConfig
    const models = getAIProviderModels(provider)

    return (
      <div className="ai-model-pricing">
        <table>
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Input</th>
              <th scope="col">Output</th>
            </tr>
          </thead>
          <tbody>
            {models.map(model => (
              <tr key={model.id}>
                <td>
                  {model.label}
                  {model.recommended ? (
                    <span className="ai-model-recommended"> · recommended</span>
                  ) : null}
                </td>
                <td>{formatTokenPrice(model.inputPrice)}</td>
                <td>{formatTokenPrice(model.outputPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="git-settings-description">
          Prices are per million tokens, in US dollars, and are reference values
          — each provider sets its own and changes them independently of
          Desktop. Check{' '}
          <LinkButton uri={getAIProviderPricingURL(provider)}>
            {getAIProviderName(provider)} pricing
          </LinkButton>{' '}
          for current rates. Commit messages send a diff and return a couple of
          lines, so the cheapest model listed is usually the right choice.
        </p>
      </div>
    )
  }

  private renderTestResult() {
    const { testState } = this.state

    if (testState.kind === 'success') {
      return (
        <p className="git-settings-description">
          Connected successfully —{' '}
          {getAIProviderName(this.props.aiProviderConfig.provider)} accepted the
          key and the model.
        </p>
      )
    }

    if (testState.kind === 'error') {
      return (
        <div className="setting-hint-warning">
          <span className="warning-icon">⚠️</span> {testState.message}
        </div>
      )
    }

    return null
  }
}
