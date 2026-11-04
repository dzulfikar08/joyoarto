// Adapted from JoyoRogo packages/api/src/lib/joyo-ai/providers.ts: the presets JoyoArto offers.
import type { AdapterKind, ProviderId } from './types';

export interface ProviderPreset {
  id: ProviderId;
  adapter: AdapterKind;
  /** Without the trailing slash. */
  baseUrl: string;
  defaultModel: string;
  suggested: readonly string[];
  /** OpenAI moved to `max_completion_tokens`; the others still take `max_tokens`. */
  maxTokensField: 'max_tokens' | 'max_completion_tokens';
  reasoningEffort: 'low' | null;
  keyUrl: string | null;
  /** The server accepts `stream_options.include_usage`. */
  streamUsage: boolean;
  keyPlaceholder: string;
  label: string;
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  anthropic: {
    id: 'anthropic',
    adapter: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-opus-5-5',
    suggested: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    maxTokensField: 'max_tokens',
    reasoningEffort: null,
    keyUrl: 'https://platform.claude.com/settings/keys',
    streamUsage: false,
    keyPlaceholder: 'sk-ant-...',
    label: 'Anthropic (Claude)',
  },
  openrouter: {
    id: 'openrouter',
    adapter: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-opus-5.5',
    suggested: ['anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-5.5'],
    maxTokensField: 'max_tokens',
    reasoningEffort: null,
    keyUrl: 'https://openrouter.ai/keys',
    streamUsage: true,
    keyPlaceholder: 'sk-or-...',
    label: 'OpenRouter',
  },
  openai: {
    id: 'openai',
    adapter: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-6-luna',
    suggested: ['gpt-6-luna', 'gpt-6.1-sol'],
    maxTokensField: 'max_completion_tokens',
    reasoningEffort: null,
    keyUrl: 'https://platform.openai.com/api-keys',
    streamUsage: true,
    keyPlaceholder: 'sk-...',
    label: 'OpenAI',
  },
  // Internal: the Workers AI binding behind the OpenAI-format shim. Never offered for a member's key (no custom URLs).
  custom: {
    id: 'custom',
    adapter: 'openai',
    baseUrl: '',
    defaultModel: '',
    suggested: [],
    maxTokensField: 'max_tokens',
    reasoningEffort: null,
    keyUrl: null,
    streamUsage: false,
    keyPlaceholder: '',
    label: 'Workers AI',
  },
};

/** Providers a member can bring a key for. Fixed base URLs: the server never calls an address the client chose. */
export const BYOK_PROVIDERS = ['anthropic', 'openrouter', 'openai'] as const satisfies readonly ProviderId[];
export type ByokProvider = (typeof BYOK_PROVIDERS)[number];
