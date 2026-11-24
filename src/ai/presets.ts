/**
 * Provider presets for AI explanations: each fills in an OpenAI-compatible
 * base URL and a default model (both stay editable). Free API keys exist for
 * Gemini (Google AI Studio), Groq, OpenRouter (`:free` models) and Mistral.
 */
export interface ProviderPreset {
  id: string
  name: string
  baseUrl: string
  model: string
  /** Where to get a key. */
  keyUrl: string
  free: boolean
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.8-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    free: true,
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    keyUrl: 'https://console.groq.com/keys',
    free: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    keyUrl: 'https://openrouter.ai/keys',
    free: true,
  },
  {
    id: 'mistral',
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
    keyUrl: 'https://console.mistral.ai/api-keys',
    free: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    free: false,
  },
  { id: 'custom', name: 'Custom (OpenAI-compatible)', baseUrl: '', model: '', keyUrl: '', free: false },
]

export function presetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id)
}
