import { AIProvider, IAIProviderConfig } from '../../models/ai-provider'
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
 * Asks for the same JSON shape Copilot returns, so the response can go through
 * parseCopilotCommitMessage and the rest of the pipeline is unchanged.
 */
const CommitMessageSystemPrompt = `You write git commit messages. Given a diff, respond with a single JSON object and nothing else:

{"title": "<summary line>", "description": "<body, or an empty string>"}

Write the title in the imperative mood, under 72 characters, with no trailing period. Use the description for why the change was made when that isn't obvious from the title; leave it empty for small self-evident changes. Do not wrap the JSON in prose.`

/** Commit messages are short; this is headroom, not a target. */
const MaxResponseTokens = 1024

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

async function sendOpenAICompatible(
  config: IAIProviderConfig,
  apiKey: string,
  prompt: string
): Promise<string> {
  const response = await fetch(
    `${getEffectiveAIBaseURL(config)}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: getEffectiveAIModel(config),
        max_tokens: MaxResponseTokens,
        messages: [
          { role: 'system', content: CommitMessageSystemPrompt },
          { role: 'user', content: prompt },
        ],
      }),
    }
  )

  if (!response.ok) {
    throw await failedRequestError(config.provider, response)
  }

  const body = await response.json()
  const content = body?.choices?.[0]?.message?.content

  if (typeof content !== 'string') {
    throw new Error(`${config.provider} returned no message content`)
  }

  return content
}

async function sendAnthropic(
  config: IAIProviderConfig,
  apiKey: string,
  prompt: string
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
      max_tokens: MaxResponseTokens,
      system: CommitMessageSystemPrompt,
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
  prompt: string
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
      systemInstruction: { parts: [{ text: CommitMessageSystemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: MaxResponseTokens },
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

/**
 * Dispatches a prompt to whichever provider the user configured.
 *
 * @param apiKeyOverride Used instead of the stored key. Lets the preferences
 *                       pane validate a key the user hasn't saved yet.
 */
async function send(
  config: IAIProviderConfig,
  prompt: string,
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
    return sendOpenAICompatible(config, apiKey, prompt)
  }

  switch (config.provider) {
    case AIProvider.Anthropic:
      return sendAnthropic(config, apiKey, prompt)
    case AIProvider.Gemini:
      return sendGemini(config, apiKey, prompt)
    default:
      return sendOpenAICompatible(config, apiKey, prompt)
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
  const content = await send(config, diff)
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
    apiKeyOverride
  )
}
