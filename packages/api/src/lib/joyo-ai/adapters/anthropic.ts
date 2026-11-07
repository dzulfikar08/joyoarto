// Joyo AI's Claude adapter, on the official SDK (@anthropic-ai/sdk). Replaces JoyoRogo's fetch-based one: same neutral
// shapes in and out, so the answer loop does not know which provider runs. Runs in the Worker (no browser access).
import Anthropic from '@anthropic-ai/sdk';
import type { BetaContentBlock, BetaContentBlockParam, BetaMessage, BetaMessageParam, BetaToolUnion, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';

import type { Adapter, CallOptions, ModelInfo, ModelReply, ModelRequest, NeutralMessage, ProviderConnection, ToolCall } from '../types';
import { AiError } from '../types';
import { cleanDetail, kindForStatus, CALL_TIMEOUT_MS, LIST_TIMEOUT_MS } from './http';

/** Adaptive thinking counts against `max_tokens`: the answer budget plus this room. */
export const THINKING_HEADROOM = 6_000;

/**
 * Server-side refusal fallback (`fallbacks: "default"`): on a policy decline the API re-runs the request on the model's
 * default fallback inside the same call. Only for the models that take it on the Claude API.
 */
const FALLBACK_MODELS = /^claude-(opus-5|fable-5|sonnet-5-5)/;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Anthropic wants alternating roles: tool results ride in a user turn and neighbours of one role are merged. */
export function toWireMessages(messages: readonly NeutralMessage[]): BetaMessageParam[] {
  const wire: BetaMessageParam[] = [];
  const push = (role: 'user' | 'assistant', blocks: BetaContentBlockParam[]) => {
    const last = wire.at(-1);
    if (last && last.role === role && Array.isArray(last.content)) last.content.push(...blocks);
    else wire.push({ role, content: blocks });
  };
  for (const message of messages) {
    if (message.role === 'user')
      push('user', [
        ...(message.images ?? []).map((img): BetaContentBlockParam => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })),
        { type: 'text', text: message.content },
      ]);
    else if (message.role === 'tool') push('user', [{ type: 'tool_result', tool_use_id: message.callId, content: message.content }]);
    else if (Array.isArray(message.raw) && message.raw.length > 0) {
      // A tool round's own blocks go back unchanged (thinking blocks included), as the API requires.
      push('assistant', message.raw as BetaContentBlockParam[]);
    } else {
      const blocks: BetaContentBlockParam[] = [];
      if (message.content !== '') blocks.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args });
      if (blocks.length > 0) push('assistant', blocks);
    }
  }
  return wire;
}

/** The request body. Exported for the request-mapping tests. */
export function buildAnthropicParams(request: ModelRequest): MessageCreateParamsNonStreaming {
  const tools: BetaToolUnion[] | undefined = request.tools?.length
    ? request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: { ...tool.parameters } }))
    : undefined;
  const params: MessageCreateParamsNonStreaming = {
    model: request.model,
    max_tokens: request.maxTokens + THINKING_HEADROOM,
    // The system prompt and tools are the same for every question of the day: cache them (the date sits at the end).
    system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
    messages: toWireMessages(request.messages),
    ...(tools ? { tools } : {}),
    output_config: { effort: request.effort ?? 'medium' },
  };
  if (FALLBACK_MODELS.test(request.model)) {
    params.betas = [FALLBACK_BETA];
    params.fallbacks = 'default';
  }
  return params;
}

/** Reads a finished message into the neutral reply. Exported for the response-mapping tests. */
export function replyOf(message: Pick<BetaMessage, 'content' | 'stop_reason' | 'usage'>): ModelReply {
  let text = '';
  let thinking = '';
  const toolCalls: ToolCall[] = [];
  for (const block of message.content) {
    if (block.type === 'text') text += block.text;
    else if (block.type === 'thinking') thinking += block.thinking;
    else if (block.type === 'tool_use') {
      const input = block.input;
      toolCalls.push({ id: block.id, name: block.name, args: typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {} });
    }
  }
  const reason = message.stop_reason ?? null;
  if (reason === 'refusal') throw new AiError('refused', 200, 'stop_reason=refusal');
  if (toolCalls.length === 0 && text.trim() === '') {
    throw new AiError(reason === 'max_tokens' ? 'truncated' : 'empty', 200, `stop_reason=${reason ?? 'none'}; thinking=${thinking.length} chars`);
  }
  const stop = toolCalls.length > 0 ? 'tools' : reason === 'max_tokens' ? 'length' : reason === 'end_turn' || reason === 'stop_sequence' ? 'end' : 'other';
  // Only what the API accepts back: server-side `fallback` markers and the like are not replayed.
  const raw = message.content.filter((b: BetaContentBlock) => b.type === 'text' || b.type === 'thinking' || b.type === 'redacted_thinking' || b.type === 'tool_use');
  return {
    text,
    thinking,
    toolCalls,
    usage: { inputTokens: (message.usage.input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0), outputTokens: message.usage.output_tokens ?? 0 },
    stop,
    finish: reason,
    raw,
  };
}

/** SDK errors as the kinds the chat words for people. The key is never part of a detail. */
export function aiErrorOf(error: unknown, key: string, outer?: AbortSignal): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof Anthropic.APIUserAbortError || outer?.aborted) return new AiError('aborted');
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AiError('timeout');
  if (error instanceof Anthropic.APIConnectionError) return new AiError('network');
  if (error instanceof Anthropic.APIError) {
    const status = typeof error.status === 'number' ? error.status : 500;
    return new AiError(kindForStatus(status, error.message), status, cleanDetail(error.message, key));
  }
  return new AiError('server', null, error instanceof Error ? cleanDetail(error.message, key) : null);
}

function clientFor(conn: Pick<ProviderConnection, 'baseUrl' | 'apiKey'>, options: CallOptions): Anthropic {
  return new Anthropic({
    apiKey: conn.apiKey,
    baseURL: conn.baseUrl,
    maxRetries: 1,
    timeout: options.timeoutMs ?? CALL_TIMEOUT_MS,
    ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
  });
}

async function complete(conn: ProviderConnection, request: ModelRequest, options: CallOptions = {}): Promise<ModelReply> {
  const client = clientFor(conn, options);
  const params = buildAnthropicParams(request);
  try {
    options.mark?.('request');
    if (!options.onDelta) return replyOf(await client.beta.messages.create(params, { signal: options.signal }));
    const stream = client.beta.messages.stream(params, { signal: options.signal });
    stream.on('text', (delta) => options.onDelta?.({ text: delta }));
    stream.on('thinking', (delta) => options.onDelta?.({ thinking: delta }));
    return replyOf(await stream.finalMessage());
  } catch (error) {
    throw aiErrorOf(error, conn.apiKey, options.signal);
  }
}

export const anthropicAdapter: Adapter = {
  complete,
  async listModels(conn, options = {}): Promise<ModelInfo[]> {
    const client = clientFor(conn, { ...options, timeoutMs: options.timeoutMs ?? LIST_TIMEOUT_MS });
    try {
      const out: ModelInfo[] = [];
      for await (const model of client.models.list({ limit: 100 }, { signal: options.signal })) out.push({ id: model.id, tools: true });
      return out;
    } catch (error) {
      throw aiErrorOf(error, conn.apiKey, options.signal);
    }
  },
};
