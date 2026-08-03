/**
 * A third-party AI service the user can point Desktop at for features like
 * commit message generation, as an alternative to GitHub Copilot.
 */
export enum AIProvider {
  Anthropic = 'anthropic',
  OpenAI = 'openai',
  Gemini = 'gemini',
  OpenRouter = 'openrouter',
}

/** A model we suggest for the provider, with what it costs to run. */
export interface IAIModelInfo {
  /** The id sent to the provider's API. */
  readonly id: string
  /** How the model is presented in the UI. */
  readonly label: string
  /** USD per million input tokens. */
  readonly inputPrice: number
  /** USD per million output tokens. */
  readonly outputPrice: number
  /**
   * Whether this is a good default for short, high-volume calls like commit
   * message generation - i.e. cheap and fast rather than most capable.
   */
  readonly recommended?: boolean
}

/**
 * Everything needed to reach a user-configured AI service, minus the API key.
 * The key lives in the credential store, never in app state - see
 * app/src/lib/ai/ai-config.ts.
 */
export interface IAIProviderConfig {
  readonly enabled: boolean
  readonly provider: AIProvider
  /** Model id. Empty means "use the provider's default". */
  readonly model: string
  /** Overrides the provider's endpoint. Empty means "use the default". */
  readonly baseURL: string
}

/**
 * Prices are per million tokens, in USD, and are reference values only - every
 * provider changes them independently of this fork, so the AI preferences pane
 * links out to each provider's own pricing page. Anthropic's figures come from
 * their published pricing table; the rest are approximate. Editing this table
 * is all it takes to correct one.
 */
const models: Record<AIProvider, ReadonlyArray<IAIModelInfo>> = {
  [AIProvider.Anthropic]: [
    {
      id: 'claude-haiku-4-5',
      label: 'Claude Haiku 4.5',
      inputPrice: 1,
      outputPrice: 5,
      recommended: true,
    },
    {
      id: 'claude-sonnet-5',
      label: 'Claude Sonnet 5',
      inputPrice: 3,
      outputPrice: 15,
    },
    {
      id: 'claude-opus-5',
      label: 'Claude Opus 5',
      inputPrice: 5,
      outputPrice: 25,
    },
  ],
  [AIProvider.OpenAI]: [
    {
      id: 'gpt-4o-mini',
      label: 'GPT-4o mini',
      inputPrice: 0.15,
      outputPrice: 0.6,
      recommended: true,
    },
    {
      id: 'gpt-4o',
      label: 'GPT-4o',
      inputPrice: 2.5,
      outputPrice: 10,
    },
  ],
  [AIProvider.Gemini]: [
    {
      id: 'gemini-2.0-flash',
      label: 'Gemini 2.0 Flash',
      inputPrice: 0.1,
      outputPrice: 0.4,
      recommended: true,
    },
    {
      id: 'gemini-1.5-pro',
      label: 'Gemini 1.5 Pro',
      inputPrice: 1.25,
      outputPrice: 5,
    },
  ],
  [AIProvider.OpenRouter]: [
    {
      id: 'google/gemini-2.0-flash-001',
      label: 'Gemini 2.0 Flash (via OpenRouter)',
      inputPrice: 0.1,
      outputPrice: 0.4,
      recommended: true,
    },
    {
      id: 'openai/gpt-4o-mini',
      label: 'GPT-4o mini (via OpenRouter)',
      inputPrice: 0.15,
      outputPrice: 0.6,
    },
    {
      id: 'anthropic/claude-sonnet-5',
      label: 'Claude Sonnet 5 (via OpenRouter)',
      inputPrice: 3,
      outputPrice: 15,
    },
  ],
}

export const supportedAIProviders: ReadonlyArray<AIProvider> = [
  AIProvider.Anthropic,
  AIProvider.OpenAI,
  AIProvider.Gemini,
  AIProvider.OpenRouter,
]

export function getAIProviderName(provider: AIProvider): string {
  switch (provider) {
    case AIProvider.Anthropic:
      return 'Anthropic (Claude)'
    case AIProvider.OpenAI:
      return 'OpenAI'
    case AIProvider.Gemini:
      return 'Google Gemini'
    case AIProvider.OpenRouter:
      return 'OpenRouter'
  }
}

/** The models we suggest for a provider, cheapest-first. */
export function getAIProviderModels(
  provider: AIProvider
): ReadonlyArray<IAIModelInfo> {
  return models[provider]
}

export function getDefaultAIModel(provider: AIProvider): string {
  const suggested = models[provider]
  return (suggested.find(m => m.recommended) ?? suggested[0]).id
}

export function getDefaultAIBaseURL(provider: AIProvider): string {
  switch (provider) {
    case AIProvider.Anthropic:
      return 'https://api.anthropic.com/v1'
    case AIProvider.OpenAI:
      return 'https://api.openai.com/v1'
    case AIProvider.Gemini:
      return 'https://generativelanguage.googleapis.com/v1beta'
    case AIProvider.OpenRouter:
      return 'https://openrouter.ai/api/v1'
  }
}

/** Where the user goes to create a key for the provider. */
export function getAIProviderKeyURL(provider: AIProvider): string {
  switch (provider) {
    case AIProvider.Anthropic:
      return 'https://console.anthropic.com/settings/keys'
    case AIProvider.OpenAI:
      return 'https://platform.openai.com/api-keys'
    case AIProvider.Gemini:
      return 'https://aistudio.google.com/apikey'
    case AIProvider.OpenRouter:
      return 'https://openrouter.ai/keys'
  }
}

/** The provider's own pricing page - the authority on the numbers above. */
export function getAIProviderPricingURL(provider: AIProvider): string {
  switch (provider) {
    case AIProvider.Anthropic:
      return 'https://www.anthropic.com/pricing'
    case AIProvider.OpenAI:
      return 'https://openai.com/api/pricing/'
    case AIProvider.Gemini:
      return 'https://ai.google.dev/pricing'
    case AIProvider.OpenRouter:
      return 'https://openrouter.ai/models'
  }
}

/** What the provider calls the secret, so the UI can label the field. */
export function getAIProviderKeyLabel(provider: AIProvider): string {
  return provider === AIProvider.Gemini ? 'API key' : 'API key or token'
}

/** Renders a per-million-token price without trailing zero noise. */
export function formatTokenPrice(pricePerMillion: number): string {
  const decimals = pricePerMillion < 1 ? 2 : 0
  return `$${pricePerMillion.toFixed(decimals)}`
}

/**
 * The bundled entry for a model id, if there is one.
 *
 * Used to fill in a price for providers whose API doesn't report one, and to
 * carry the "recommended" mark onto a live model list.
 */
export function getReferenceModelInfo(
  provider: AIProvider,
  modelId: string
): IAIModelInfo | undefined {
  return models[provider].find(m => m.id === modelId)
}

/** Whether the provider reports prices through its API. */
export function providerReportsPricing(provider: AIProvider): boolean {
  // OpenRouter publishes per-token prices for its whole catalogue; OpenAI,
  // Anthropic, and Google all return model metadata with no cost fields.
  return provider === AIProvider.OpenRouter
}

export function parseAIProvider(value: string | null): AIProvider | null {
  return supportedAIProviders.find(p => p === value) ?? null
}

export const defaultAIProviderConfig: IAIProviderConfig = {
  enabled: false,
  provider: AIProvider.Anthropic,
  model: '',
  baseURL: '',
}
