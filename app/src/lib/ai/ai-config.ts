import {
  AIProvider,
  IAIProviderConfig,
  defaultAIProviderConfig,
  getDefaultAIBaseURL,
  getDefaultAIModel,
  parseAICommitMessageDetail,
  parseAIProvider,
} from '../../models/ai-provider'
import { TokenStore } from '../stores/token-store'
import { getBoolean, setBoolean } from '../local-storage'

const enabledKey = 'aiProviderEnabled'
const providerKey = 'aiProviderName'
const modelKey = 'aiProviderModel'
const baseURLKey = 'aiProviderBaseURL'
const detailKey = 'aiProviderCommitMessageDetail'

/**
 * Service name for the credential store. The API key is keyed by provider so
 * switching providers doesn't destroy the key for the previous one.
 */
const AIProviderTokenStoreKey = 'com.knwr.GitHubDesktop.aiProvider'

/**
 * The user's AI provider configuration, read straight from local storage.
 *
 * Deliberately synchronous and not part of IAppState: the commit message
 * button's enabled check runs during render, and the API key must never enter
 * the renderer state tree (see getAIAPIKey).
 */
export function getAIProviderConfig(): IAIProviderConfig {
  const provider =
    parseAIProvider(localStorage.getItem(providerKey)) ??
    defaultAIProviderConfig.provider

  return {
    enabled: getBoolean(enabledKey, defaultAIProviderConfig.enabled),
    provider,
    model: localStorage.getItem(modelKey) ?? '',
    baseURL: localStorage.getItem(baseURLKey) ?? '',
    // Unset for everyone who configured a provider before this setting existed,
    // which is exactly who should keep the old, concise output.
    detail:
      parseAICommitMessageDetail(localStorage.getItem(detailKey)) ??
      defaultAIProviderConfig.detail,
  }
}

export function setAIProviderConfig(config: IAIProviderConfig) {
  setBoolean(enabledKey, config.enabled)
  localStorage.setItem(providerKey, config.provider)
  localStorage.setItem(modelKey, config.model)
  localStorage.setItem(baseURLKey, config.baseURL)
  localStorage.setItem(detailKey, config.detail)
}

/**
 * Whether Desktop should route AI features through the user's own provider.
 *
 * Requires a model and an endpoint to resolve to something, which they always
 * do via the provider defaults - so in practice this is just the toggle.
 */
export function isCustomAIEnabled(): boolean {
  return getAIProviderConfig().enabled
}

/** The model to send, falling back to the provider's default. */
export function getEffectiveAIModel(config: IAIProviderConfig): string {
  return config.model.trim() === ''
    ? getDefaultAIModel(config.provider)
    : config.model.trim()
}

/** The endpoint to call, falling back to the provider's default. */
export function getEffectiveAIBaseURL(config: IAIProviderConfig): string {
  const configured = config.baseURL.trim().replace(/\/+$/, '')
  return configured === '' ? getDefaultAIBaseURL(config.provider) : configured
}

/**
 * Reads the API key for a provider out of the OS credential store.
 *
 * Read this on demand at call time rather than holding it in memory - it keeps
 * the secret out of app state, logs, and crash reports.
 */
export function getAIAPIKey(provider: AIProvider): Promise<string | null> {
  return TokenStore.getItem(AIProviderTokenStoreKey, provider)
}

export function setAIAPIKey(provider: AIProvider, key: string): Promise<void> {
  return TokenStore.setItem(AIProviderTokenStoreKey, provider, key)
}

export function deleteAIAPIKey(provider: AIProvider): Promise<boolean> {
  return TokenStore.deleteItem(AIProviderTokenStoreKey, provider)
}
