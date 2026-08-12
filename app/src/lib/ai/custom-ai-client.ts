import {
  AICommitMessageDetail,
  AIProvider,
  IAIProviderConfig,
} from '../../models/ai-provider'
import {
  ICopilotCommitMessage,
  parseCopilotCommitMessage,
} from '../copilot-commit-message'
import {
  getAIAPIKey,
  getEffectiveAIBaseURL,
  getEffectiveAIModel,
} from './ai-config'

/**
 * Every level asks for the same JSON shape Copilot returns, so responses go
 * through parseCopilotCommitMessage and the rest of the pipeline is unchanged.
 *
 * The shared preamble keeps the title rules identical across levels - only the
 * description brief changes, because that's the part the user is asking for more
 * of.
 */
const CommitMessagePreamble = `You write git commit messages. Given a diff, respond with a single JSON object and nothing else:

{"title": "<summary line>", "description": "<body, or an empty string>"}

Write the title in the imperative mood, under 72 characters, with no trailing period. Do not wrap the JSON in prose.`

/**
 * Only ever describe what the diff shows. Longer briefs invite invention, and a
 * confidently wrong commit message is worse than a thin one.
 */
const GroundingRule = `Base every statement on the diff itself. If the diff doesn't show why a change was made, say what it does instead of guessing at intent.`

function getCommitMessageSystemPrompt(detail: AICommitMessageDetail): string {
  switch (detail) {
    // Unchanged wording from before the setting existed, so the default output
    // stays exactly what it was.
    case AICommitMessageDetail.Concise:
      return `${CommitMessagePreamble}

Use the description for why the change was made when that isn't obvious from the title; leave it empty for small self-evident changes.`

    case AICommitMessageDetail.Detailed:
      return `${CommitMessagePreamble}

Write a description that spares the reader from having to read the diff:
- Open with a short paragraph on what changed and why.
- Then one "- " bullet per meaningful change, naming the file, function, or symbol it touches.
- Call out behaviour changes, new or removed options, and anything a reader would find surprising.

Collapse purely mechanical edits (formatting, renames, lockfiles, generated output) into a single bullet rather than one each. Separate lines with "\\n" and wrap prose at about 72 characters. ${GroundingRule}`

    case AICommitMessageDetail.Thorough:
      return `${CommitMessagePreamble}

Write a thorough description, using "\\n" for line breaks and wrapping prose at about 72 characters, organised as:

What changed: a "- " bullet per file or area, naming the functions, symbols, or settings touched and what happened to each.
Why: the problem the change solves, as far as the diff shows it.
Impact: behaviour and API changes, anything callers or users have to do differently, and risks or edge cases the diff leaves open.

Drop a section when the diff genuinely has nothing to put in it, and collapse purely mechanical edits (formatting, renames, lockfiles, generated output) into one bullet. ${GroundingRule}`
  }
}

/**
 * Output ceilings, not targets. Each level needs room for the description it was
 * asked for, and reasoning models spend part of this budget before they emit any
 * text at all.
 */
function getMaxResponseTokens(detail: AICommitMessageDetail): number {
  switch (detail) {
    case AICommitMessageDetail.Concise:
      return 1024
    case AICommitMessageDetail.Detailed:
      return 2048
    case AICommitMessageDetail.Thorough:
      return 4096
  }
}

/** Providers that speak the OpenAI chat-completions dialect. */
function isOpenAICompatible(provider: AIProvider): boolean {
  return provider === AIProvider.OpenAI || provider === AIProvider.OpenRouter
}

/**
 * Surfaces a failed request without leaking the request itself. Bodies are
 * truncated because some gateways echo large HTML error pages.
 */
async function failedRequestError(
  provider: AIProvider,
  response: Response
): Promise<Error> {
  let detail = ''

  try {
    detail = (await response.text()).slice(0, 500)
  } catch {
    // The body isn't essential to the error; the status carries the signal.
  }

  return new Error(
    `${provider} request failed (${response.status} ${response.statusText})${
      detail === '' ? '' : `: ${detail}`
    }`
  )
}

/** The two spellings OpenAI-compatible APIs use for the output token cap. */
type TokenLimitParam = 'max_tokens' | 'max_completion_tokens'

function postChatCompletion(
  config: IAIProviderConfig,
  apiKey: string,
  prompt: string,
  detail: AICommitMessageDetail,
  tokenLimitParam: TokenLimitParam
): Promise<Response> {
  return fetch(`${getEffectiveAIBaseURL(config)}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: getEffectiveAIModel(config),
      [tokenLimitParam]: getMaxResponseTokens(detail),
      messages: [
        { role: 'system', content: getCommitMessageSystemPrompt(detail) },
        { role: 'user', content: prompt },
      ],
    }),
  })
}

async function sendOpenAICompatible(
  config: IAIProviderConfig,
  apiKey: string,
  prompt: string,
  detail: AICommitMessageDetail
): Promise<string> {
  let response = await postChatCompletion(
    config,
    apiKey,
    prompt,
    detail,
    'max_tokens'
  )

  // Newer OpenAI models reject max_tokens outright and require
  // max_completion_tokens. Which models those are keeps changing, so react to
  // the error the API actually returns rather than pattern-matching model names
  // that will be out of date by the next release.
  if (response.status === 400) {
    const errorBody = await response.text()

    if (errorBody.includes('max_completion_tokens')) {
      response = await postChatCompletion(
        config,
        apiKey,
        prompt,
        detail,
        'max_completion_tokens'
      )
    } else {
      throw new Error(
        `${config.provider} request failed (400 ${
          response.statusText
        }): ${errorBody.slice(0, 500)}`
      )
    }
  }

  if (!response.ok) {
    throw await failedRequestError(config.provider, response)
  }

  const body = await response.json()
  const choice = body?.choices?.[0]
  const content = choice?.message?.content

  if (typeof content !== 'string' || content === '') {
    // Reasoning models count their thinking against the output cap, so a model
    // can hit the ceiling before writing a single character. Say so, rather than
    // reporting an empty response the user can't act on.
    if (choice?.finish_reason === 'length') {
      throw new Error(
        `${config.provider} hit its output token limit before returning a commit message. Try a lower detail level in Preferences > AI, or a model that reasons less.`
      )
    }

    throw new Error(`${config.provider} returned no message content`)
  }

  return content
}

async function sendAnthropic(
  config: IAIProviderConfig,
  apiKey: string,
  prompt: string,
  detail: AICommitMessageDetail
): Promise<string> {
  const response = await fetch(`${getEffectiveAIBaseURL(config)}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: getEffectiveAIModel(config),
      max_tokens: getMaxResponseTokens(detail),
      system: getCommitMessageSystemPrompt(detail),
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    throw await failedRequestError(config.provider, response)
  }

  const body = await response.json()

  // Anthropic returns an array of content blocks; only the text ones matter
  // here, and a refusal comes back as a successful response with no text.
  const text = (body?.content ?? [])
    .filter((block: any) => block?.type === 'text')
    .map((block: any) => block.text)
    .join('')

  if (text === '') {
    throw new Error(
      `Anthropic returned no text content (stop reason: ${
        body?.stop_reason ?? 'unknown'
      })`
    )
  }

  return text
}

async function sendGemini(
  config: IAIProviderConfig,
  apiKey: string,
  prompt: string,
  detail: AICommitMessageDetail
): Promise<string> {
  const model = getEffectiveAIModel(config)
  const url = `${getEffectiveAIBaseURL(config)}/models/${encodeURIComponent(
    model
  )}:generateContent`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Header rather than a query parameter so the key stays out of URLs
      // (which end up in logs and error messages).
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: getCommitMessageSystemPrompt(detail) }],
      },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: getMaxResponseTokens(detail) },
    }),
  })

  if (!response.ok) {
    throw await failedRequestError(config.provider, response)
  }

  const body = await response.json()
  const text = (body?.candidates?.[0]?.content?.parts ?? [])
    .map((part: any) => part?.text ?? '')
    .join('')

  if (text === '') {
    throw new Error('Gemini returned no text content')
  }

  return text
}

/** Where a price came from, so the UI can attribute it honestly. */
export type AIPriceSource = 'provider' | 'community'

/** A model as reported by the provider itself, rather than a hardcoded guess. */
export interface IFetchedAIModel {
  readonly id: string
  readonly label: string
  /**
   * USD per million input tokens. Null means "unknown", never "free".
   */
  readonly inputPrice: number | null
  readonly outputPrice: number | null
  readonly priceSource: AIPriceSource | null
}

/**
 * LiteLLM's price catalogue - the only machine-readable source of current rates
 * that covers OpenAI, Anthropic, and Google, none of which expose pricing
 * through their own APIs. Community-maintained rather than official, which is
 * why the UI attributes it and still links to each provider's pricing page.
 */
const PriceCatalogURL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

interface IPriceEntry {
  readonly inputPrice: number | null
  readonly outputPrice: number | null
}

/**
 * Fetched once per session - it's ~1.7MB, and prices don't move within a
 * sitting. The promise itself is cached so concurrent callers share one request.
 */
let priceCatalog: Promise<Map<string, IPriceEntry>> | null = null

function toPerMillion(costPerToken: unknown): number | null {
  const parsed = Number.parseFloat(String(costPerToken))
  return Number.isFinite(parsed) ? parsed * 1_000_000 : null
}

function fetchPriceCatalog(): Promise<Map<string, IPriceEntry>> {
  if (priceCatalog === null) {
    priceCatalog = (async () => {
      const response = await fetch(PriceCatalogURL)

      if (!response.ok) {
        throw new Error(
          `Price catalogue request failed (${response.status} ${response.statusText})`
        )
      }

      const body = await response.json()
      const catalog = new Map<string, IPriceEntry>()

      for (const [key, value] of Object.entries<any>(body)) {
        const entry = {
          inputPrice: toPerMillion(value?.input_cost_per_token),
          outputPrice: toPerMillion(value?.output_cost_per_token),
        }

        if (entry.inputPrice === null && entry.outputPrice === null) {
          continue
        }

        catalog.set(key.toLowerCase(), entry)

        // Catalogue keys are sometimes namespaced ("vertex_ai/gemini-2.0-flash")
        // while provider APIs return the bare id, so index both spellings.
        const bare = key.slice(key.lastIndexOf('/') + 1).toLowerCase()
        if (!catalog.has(bare)) {
          catalog.set(bare, entry)
        }
      }

      return catalog
    })().catch(e => {
      // Don't cache a failure - a later attempt should be able to retry.
      priceCatalog = null
      throw e
    })
  }

  return priceCatalog
}

function lookupPrice(
  catalog: Map<string, IPriceEntry>,
  modelId: string
): IPriceEntry | undefined {
  const id = modelId.toLowerCase()

  return (
    catalog.get(id) ??
    // Anthropic and Google both ship dated snapshots ("...-20250929") that the
    // catalogue lists under the undated alias.
    catalog.get(id.replace(/-\d{8}$/, '')) ??
    catalog.get(id.replace(/-latest$/, ''))
  )
}

/**
 * Fills in prices from the community catalogue for models whose provider didn't
 * report one.
 *
 * Best effort by design: if the catalogue is unreachable the models still load,
 * just without prices. Failing the whole list over a missing price would be
 * worse than showing a dash.
 */
async function withCatalogPrices(
  models: ReadonlyArray<IFetchedAIModel>
): Promise<ReadonlyArray<IFetchedAIModel>> {
  let catalog: Map<string, IPriceEntry>

  try {
    catalog = await fetchPriceCatalog()
  } catch (e) {
    log.warn('Could not fetch the AI model price catalogue', e)
    return models
  }

  return models.map(model => {
    if (model.inputPrice !== null) {
      return model
    }

    const price = lookupPrice(catalog, model.id)

    return price === undefined
      ? model
      : {
          ...model,
          inputPrice: price.inputPrice,
          outputPrice: price.outputPrice,
          priceSource: 'community' as const,
        }
  })
}

/** OpenRouter quotes per-token strings; the UI works in per-million. */
function perMillion(pricePerToken: unknown): number | null {
  const parsed = Number.parseFloat(String(pricePerToken))
  return Number.isFinite(parsed) ? parsed * 1_000_000 : null
}

/** Endpoints that aren't chat models and would only clutter the list. */
function isChatModelId(id: string): boolean {
  return !/embedding|whisper|tts|dall-e|moderation|transcribe|image/i.test(id)
}

async function fetchJSON(
  provider: AIProvider,
  url: string,
  headers: Record<string, string>
): Promise<any> {
  const response = await fetch(url, { headers })

  if (!response.ok) {
    throw await failedRequestError(provider, response)
  }

  return response.json()
}

/**
 * Asks the provider which models it offers.
 *
 * Only OpenRouter returns prices, so for every other provider the price fields
 * come back null and the caller is responsible for not implying a cost it
 * doesn't know.
 */
export async function fetchAIModels(
  config: IAIProviderConfig,
  apiKeyOverride?: string
): Promise<ReadonlyArray<IFetchedAIModel>> {
  const base = getEffectiveAIBaseURL(config)
  const { provider } = config

  // OpenRouter's catalogue is public, so it works before a key is entered.
  if (provider === AIProvider.OpenRouter) {
    const body = await fetchJSON(provider, `${base}/models`, {})

    return (body?.data ?? [])
      .filter((m: any) => typeof m?.id === 'string')
      .map((m: any) => ({
        id: m.id,
        label: typeof m.name === 'string' ? m.name : m.id,
        inputPrice: perMillion(m?.pricing?.prompt),
        outputPrice: perMillion(m?.pricing?.completion),
        priceSource: 'provider' as const,
      }))
  }

  const apiKey =
    apiKeyOverride !== undefined && apiKeyOverride !== ''
      ? apiKeyOverride
      : await getAIAPIKey(provider)

  if (apiKey === null || apiKey === '') {
    throw new Error('Enter an API key first, then load the model list.')
  }

  if (provider === AIProvider.Anthropic) {
    const body = await fetchJSON(provider, `${base}/models`, {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    })

    return withCatalogPrices(
      (body?.data ?? [])
        .filter((m: any) => typeof m?.id === 'string')
        .map((m: any) => ({
          id: m.id,
          label: typeof m.display_name === 'string' ? m.display_name : m.id,
          inputPrice: null,
          outputPrice: null,
          priceSource: null,
        }))
    )
  }

  if (provider === AIProvider.Gemini) {
    const body = await fetchJSON(provider, `${base}/models`, {
      'x-goog-api-key': apiKey,
    })

    const geminiModels = (body?.models ?? [])
      .filter((m: any) =>
        (m?.supportedGenerationMethods ?? []).includes('generateContent')
      )
      .map((m: any) => {
        // Gemini ids arrive namespaced, e.g. "models/gemini-2.0-flash".
        const id = String(m.name).replace(/^models\//, '')
        return {
          id,
          label: typeof m.displayName === 'string' ? m.displayName : id,
          inputPrice: null,
          outputPrice: null,
          priceSource: null,
        }
      })

    return withCatalogPrices(geminiModels)
  }

  // OpenAI and anything else speaking its dialect.
  const body = await fetchJSON(provider, `${base}/models`, {
    authorization: `Bearer ${apiKey}`,
  })

  return withCatalogPrices(
    (body?.data ?? [])
      .filter((m: any) => typeof m?.id === 'string' && isChatModelId(m.id))
      .map((m: any) => ({
        id: m.id,
        label: m.id,
        inputPrice: null,
        outputPrice: null,
        priceSource: null,
      }))
  )
}

/**
 * Dispatches a prompt to whichever provider the user configured.
 *
 * @param detail          Which system prompt and token budget to use, rather
 *                        than the configured one. The connection test overrides
 *                        it so verifying a key stays cheap regardless of the
 *                        detail level the user picked.
 * @param apiKeyOverride  Used instead of the stored key. Lets the preferences
 *                        pane validate a key the user hasn't saved yet.
 */
async function send(
  config: IAIProviderConfig,
  prompt: string,
  detail: AICommitMessageDetail,
  apiKeyOverride?: string
): Promise<string> {
  const apiKey =
    apiKeyOverride !== undefined && apiKeyOverride !== ''
      ? apiKeyOverride
      : await getAIAPIKey(config.provider)

  if (apiKey === null || apiKey === '') {
    throw new Error(
      `No API key stored for ${config.provider}. Add one in Preferences > AI.`
    )
  }

  if (isOpenAICompatible(config.provider)) {
    return sendOpenAICompatible(config, apiKey, prompt, detail)
  }

  switch (config.provider) {
    case AIProvider.Anthropic:
      return sendAnthropic(config, apiKey, prompt, detail)
    case AIProvider.Gemini:
      return sendGemini(config, apiKey, prompt, detail)
    default:
      return sendOpenAICompatible(config, apiKey, prompt, detail)
  }
}

/**
 * Generates a commit message for the given diff using the user's own AI
 * provider, bypassing Copilot entirely.
 *
 * @param config The provider configuration to use
 * @param diff The diff of changes to be committed, in git format
 * @throws If no key is stored, the request fails, or the response isn't the
 *         expected JSON shape
 */
export async function generateCommitMessageWithCustomAI(
  config: IAIProviderConfig,
  diff: string
): Promise<ICopilotCommitMessage> {
  const content = await send(config, diff, config.detail)
  return parseCopilotCommitMessage(content)
}

/**
 * Round-trips a trivial prompt so the user can confirm their key, model, and
 * endpoint work before relying on them.
 *
 * @throws If the provider rejects the request
 */
export async function verifyAIProvider(
  config: IAIProviderConfig,
  apiKeyOverride?: string
): Promise<void> {
  await send(
    config,
    'Respond with {"title": "test", "description": ""}.',
    AICommitMessageDetail.Concise,
    apiKeyOverride
  )
}
