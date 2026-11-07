// Ported from JoyoRogo packages/api/src/lib/joyo-ai/types.ts (itself from JoyoFit), adapted for JoyoArto.
/**
 * Joyo AI's neutral shapes: what the answer loop, the finance tools and the provider adapters share. `custom` is internal
 * (the Workers AI shim speaks the OpenAI format); a member's own key can only be for the providers in `BYOK_PROVIDERS`.
 */

export const PROVIDER_IDS = ['anthropic', 'openrouter', 'openai', 'custom'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** The request format a provider speaks: OpenAI chat completions (OpenAI, OpenRouter, Gemini's compatible endpoint, custom) or Anthropic Messages. */
export type AdapterKind = 'openai' | 'anthropic';

/** Who pays for the model: JoyoArto (hosted, counted in the daily cap) or the member's own key. */
export type Engine = 'hosted' | 'byok';

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** A conversation turn in neutral form; each adapter translates it. */
/** An image the member attached to a question (a photo, a screenshot, a scanned PDF page), base64 without the data: prefix. */
export type ChatImage = { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string };

export type NeutralMessage =
  | { role: 'user'; content: string; images?: readonly ChatImage[] }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[]; /** Reasoning text the provider sent with this turn; passed back only in tool rounds, as thinking models expect. */ reasoning?: string; /** The provider's own content blocks of this turn (Anthropic: thinking + tool_use), replayed unchanged in tool rounds. */ raw?: unknown }
  | { role: 'tool'; callId: string; name: string; content: string };

/** JSON Schema subset the tools use. */
export interface ToolSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: ToolSchema;
}

export interface ModelRequest {
  model: string;
  /** Anthropic `output_config.effort`; ignored elsewhere. */
  effort?: 'low' | 'medium' | 'high';
  system: string;
  messages: readonly NeutralMessage[];
  tools?: readonly ToolSpec[];
  maxTokens: number;
  /** Ask the model not to think at length (a faster, shorter-thinking answer) where the server understands it. */
  fast?: boolean;
  /** Extra request fields for fast mode, from the person (JSON object); replaces the built-in fields of the provider. */
  fastFields?: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelReply {
  text: string;
  /** Reasoning the model wrote before answering (`reasoning_content`, `reasoning`, `<think>`, Anthropic thinking). Never the answer; empty when none. */
  thinking: string;
  toolCalls: ToolCall[];
  usage: Usage | null;
  stop: 'end' | 'tools' | 'length' | 'other';
  /** The provider's own stop word (`stop`, `length`, `tool_calls`, `end_turn`, `max_tokens`...), for the technical details line. */
  finish: string | null;
  /** The provider's own content blocks, for replaying the turn in the next tool round (Anthropic thinking blocks must come back unchanged). */
  raw?: unknown;
}

/** A piece of an answer while it is being written (streaming). */
export interface StreamDelta {
  text?: string;
  thinking?: string;
}

/** What went wrong with a provider call, worded for the person by the UI (`ai:errors.<kind>`). */
export type AiErrorKind =
  | 'badKey'
  | 'forbidden'
  | 'quota'
  | 'rateLimit'
  | 'modelNotFound'
  | 'noTools'
  | 'badRequest'
  | 'server'
  | 'network'
  | 'timeout'
  | 'empty'
  /** The model used its whole output budget before writing an answer (a thinking model that kept thinking). */
  | 'truncated'
  | 'aborted'
  /** The model declined (Claude's safety classifiers), after any fallback model also declined. */
  | 'refused'
  /** Not allowed to call: no consent, no key, under 18, daily ceiling. Nothing was sent. */
  | 'blocked';

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    readonly status: number | null = null,
    /** The provider's own message, for the details line. Never contains the key. */
    readonly detail: string | null = null,
  ) {
    super(`ai-${kind}`);
  }
}

export interface ProviderConnection {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ModelInfo {
  id: string;
  /** False when the provider's list says the model has no tool calling; null when the list does not say. */
  tools: boolean | null;
}

export interface CallOptions {
  signal?: AbortSignal;
  /** Deadline of one provider call. */
  timeoutMs?: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  /**
   * Called with each piece of the answer as it arrives. Giving it asks the adapter to stream (server-sent events); a provider or
   * runtime that cannot stream makes the adapter answer without streaming, and then the whole answer comes in one call.
   */
  onDelta?: (delta: StreamDelta) => void;
  /** Timing marks of this call (`request`, `first-byte`, ...), for finding where a slow answer spends its time. */
  mark?: (name: string, extra?: Record<string, number | string>) => void;
}

export interface Adapter {
  complete(conn: ProviderConnection, request: ModelRequest, options?: CallOptions): Promise<ModelReply>;
  listModels(conn: Pick<ProviderConnection, 'baseUrl' | 'apiKey'>, options?: CallOptions): Promise<ModelInfo[]>;
}
