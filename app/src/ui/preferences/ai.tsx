import * as React from 'react'
import { DialogContent } from '../dialog'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { Select } from '../lib/select'
import { TextBox } from '../lib/text-box'
import { LinkButton } from '../lib/link-button'
import { Button } from '../lib/button'
import {
  AIProvider,
  IAIProviderConfig,
  formatTokenPrice,
  getAIProviderKeyLabel,
  getAIProviderKeyURL,
  getAIProviderModels,
  getAIProviderName,
  getAIProviderPricingURL,
  getDefaultAIBaseURL,
  getDefaultAIModel,
  getReferenceModelInfo,
  parseAIProvider,
  providerReportsPricing,
  supportedAIProviders,
} from '../../models/ai-provider'
import {
  AIPriceSource,
  IFetchedAIModel,
  fetchAIModels,
  verifyAIProvider,
} from '../../lib/ai/custom-ai-client'

/**
 * How many rows of the price table to build.
 *
 * The table scrolls inside its own bounded container, so this only caps how much
 * is rendered - it does not affect the dialog's height.
 */
const MaxPricingRows = 30

interface IAIPreferencesProps {
  readonly aiProviderConfig: IAIProviderConfig
  /** The key as currently edited. Empty means "none stored". */
  readonly aiAPIKey: string
  readonly onAIProviderConfigChanged: (config: IAIProviderConfig) => void
  readonly onAIAPIKeyChanged: (key: string) => void
}

/** A model row, whether it came from the provider or from the bundled table. */
interface IDisplayModel {
  readonly id: string
  readonly label: string
  readonly inputPrice: number | null
  readonly outputPrice: number | null
  readonly recommended: boolean
  /** Where the price came from, or null when no price is known. */
  readonly priceSource: AIPriceSource | 'bundled' | null
}

type AsyncState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'success'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string }

interface IAIPreferencesState {
  readonly testState: AsyncState
  readonly modelsState: AsyncState
  /** Models reported by the provider, or null before they've been loaded. */
  readonly models: ReadonlyArray<IFetchedAIModel> | null
}

/** Cheapest first; models with no known price sort to the bottom. */
function byPriceThenLabel(a: IDisplayModel, b: IDisplayModel): number {
  if (a.inputPrice === null && b.inputPrice === null) {
    return a.label.localeCompare(b.label)
  }
  if (a.inputPrice === null) {
    return 1
  }
  if (b.inputPrice === null) {
    return -1
  }
  return a.inputPrice - b.inputPrice || a.label.localeCompare(b.label)
}

export class AI extends React.Component<
  IAIPreferencesProps,
  IAIPreferencesState
> {
  public constructor(props: IAIPreferencesProps) {
    super(props)
    this.state = {
      testState: { kind: 'idle' },
      modelsState: { kind: 'idle' },
      models: null,
    }
  }

  /**
   * The provider whose list we've already tried to load, so a failed attempt
   * isn't retried on every render.
   */
  private autoLoadedFor: AIProvider | null = null

  public componentDidMount() {
    this.maybeAutoLoadModels()
  }

  public componentDidUpdate() {
    // The stored key arrives asynchronously from the credential store, so the
    // first render usually has nothing to authenticate with.
    this.maybeAutoLoadModels()
  }

  /**
   * Loads the model list without waiting for the user to ask.
   *
   * Showing the small bundled list until someone finds the button meant the pane
   * offered two stale models when the provider has hundreds.
   */
  private maybeAutoLoadModels() {
    const { aiProviderConfig: config, aiAPIKey } = this.props

    if (!config.enabled || this.autoLoadedFor === config.provider) {
      return
    }

    // OpenRouter's catalogue is public; everyone else needs the key. The length
    // check keeps this from firing on the first character of a key being typed,
    // which would spend the one attempt on a request that can't succeed.
    if (config.provider !== AIProvider.OpenRouter && aiAPIKey.length < 20) {
      return
    }

    this.autoLoadedFor = config.provider
    this.onLoadModels()
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

    // Model ids, endpoints, keys, and model lists are all provider-specific, so
    // carrying any of them over would leave the pane describing the wrong
    // service.
    this.props.onAIProviderConfigChanged({
      ...this.props.aiProviderConfig,
      provider,
      model: '',
      baseURL: '',
    })
    this.props.onAIAPIKeyChanged('')
    this.autoLoadedFor = null
    this.setState({
      testState: { kind: 'idle' },
      modelsState: { kind: 'idle' },
      models: null,
    })
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
    this.setState({ testState: { kind: 'busy' } })

    try {
      // Pass the in-flight key so the user can validate before saving.
      await verifyAIProvider(this.props.aiProviderConfig, this.props.aiAPIKey)
      this.setState({
        testState: {
          kind: 'success',
          message: `Connected — ${getAIProviderName(
            this.props.aiProviderConfig.provider
          )} accepted the key and the model.`,
        },
      })
    } catch (e) {
      this.setState({
        testState: { kind: 'error', message: (e as Error).message },
      })
    }
  }

  private onLoadModels = async () => {
    const { provider } = this.props.aiProviderConfig
    this.setState({ modelsState: { kind: 'busy' } })

    try {
      const models = await fetchAIModels(
        this.props.aiProviderConfig,
        this.props.aiAPIKey
      )

      const priced = models.filter(m => m.inputPrice !== null).length
      const message = providerReportsPricing(provider)
        ? `Loaded ${
            models.length
          } models with live prices from ${getAIProviderName(provider)}.`
        : `Loaded ${models.length} models from ${getAIProviderName(
            provider
          )}.` +
          (priced === 0
            ? ' This provider does not publish prices through its API.'
            : '')

      this.setState({ models, modelsState: { kind: 'success', message } })
    } catch (e) {
      this.setState({
        modelsState: { kind: 'error', message: (e as Error).message },
      })
    }
  }

  /**
   * The model rows to show: the provider's own list once loaded, otherwise the
   * small bundled list so the pane is usable before a key is entered.
   */
  private get displayModels(): ReadonlyArray<IDisplayModel> {
    const { provider } = this.props.aiProviderConfig
    const fetched = this.state.models

    if (fetched === null) {
      return getAIProviderModels(provider)
        .map(m => ({
          id: m.id,
          label: m.label,
          inputPrice: m.inputPrice,
          outputPrice: m.outputPrice,
          recommended: m.recommended === true,
          priceSource: 'bundled' as const,
        }))
        .sort(byPriceThenLabel)
    }

    return fetched
      .map(m => {
        // The bundled table is the last resort: a price from the provider or the
        // community catalogue always wins over one compiled into the app.
        const reference = getReferenceModelInfo(provider, m.id)
        const bundled = m.inputPrice === null && reference !== undefined

        return {
          id: m.id,
          label: m.label,
          inputPrice: m.inputPrice ?? reference?.inputPrice ?? null,
          outputPrice: m.outputPrice ?? reference?.outputPrice ?? null,
          recommended: reference?.recommended === true,
          priceSource: bundled ? ('bundled' as const) : m.priceSource,
        }
      })
      .sort(byPriceThenLabel)
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
    const models = this.displayModels
    const selectedModel =
      config.model === '' ? getDefaultAIModel(config.provider) : config.model
    const busy =
      this.state.testState.kind === 'busy' ||
      this.state.modelsState.kind === 'busy'

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
                {model.label}
                {model.inputPrice !== null && model.outputPrice !== null
                  ? ` — ${formatTokenPrice(
                      model.inputPrice
                    )} in / ${formatTokenPrice(model.outputPrice)} out`
                  : ''}
              </option>
            ))}
          </Select>

          <div className="ai-model-actions">
            <Button onClick={this.onLoadModels} disabled={busy}>
              {this.state.modelsState.kind === 'busy'
                ? 'Loading models…'
                : 'Load models from provider'}
            </Button>
          </div>
          {this.renderState(this.state.modelsState)}

          {this.renderPricingTable(models)}
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
            disabled={aiAPIKey === '' || busy}
          >
            {this.state.testState.kind === 'busy'
              ? 'Testing…'
              : 'Test connection'}
          </Button>
          {this.renderState(this.state.testState)}
        </div>
      </>
    )
  }

  private renderPricingTable(models: ReadonlyArray<IDisplayModel>) {
    const rows = models.slice(0, MaxPricingRows)
    const truncated = models.length - rows.length

    return (
      <div className="ai-model-pricing">
        {/* Bounded and scrollable: a long model list must not grow the
            Preferences dialog past the bottom of the screen. */}
        <div className="ai-model-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col">Input</th>
                <th scope="col">Output</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(model => (
                <tr key={model.id}>
                  <td>
                    {model.label}
                    {model.recommended ? (
                      <span className="ai-model-recommended">
                        {' '}
                        · recommended
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {model.inputPrice === null
                      ? '—'
                      : formatTokenPrice(model.inputPrice)}
                  </td>
                  <td>
                    {model.outputPrice === null
                      ? '—'
                      : formatTokenPrice(model.outputPrice)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {truncated > 0 ? (
          <p className="git-settings-description">
            Showing the {rows.length} cheapest of {models.length} models. The
            full list is in the dropdown above.
          </p>
        ) : null}
        {this.renderPricingNote()}
      </div>
    )
  }

  private renderPricingNote() {
    const { provider } = this.props.aiProviderConfig
    const models = this.displayModels
    const sources = new Set(
      models.map(m => m.priceSource).filter(s => s !== null)
    )

    return (
      <p className="git-settings-description">
        Prices are per million tokens, in US dollars, cheapest first; a dash
        means the price isn't known.{' '}
        {this.state.models === null
          ? 'Load the model list to see the models your key can actually use, with current prices.'
          : ''}
        {sources.has('provider')
          ? `Prices come from ${getAIProviderName(provider)}'s own API. `
          : ''}
        {sources.has('community')
          ? `${getAIProviderName(
              provider
            )} does not publish prices through its API, so these come from the community-maintained LiteLLM catalogue, fetched just now rather than compiled into the app. `
          : ''}
        {sources.has('bundled')
          ? 'Some figures come from a small table bundled with the app and can go out of date. '
          : ''}
        Check{' '}
        <LinkButton uri={getAIProviderPricingURL(provider)}>
          {getAIProviderName(provider)} pricing
        </LinkButton>{' '}
        for the authoritative rates. Commit messages send a diff and return a
        couple of lines, so a cheap model is usually the right choice.
      </p>
    )
  }

  private renderState(state: AsyncState) {
    if (state.kind === 'success') {
      return <p className="git-settings-description">{state.message}</p>
    }

    if (state.kind === 'error') {
      return (
        <div className="setting-hint-warning">
          <span className="warning-icon">⚠️</span> {state.message}
        </div>
      )
    }

    return null
  }
}
