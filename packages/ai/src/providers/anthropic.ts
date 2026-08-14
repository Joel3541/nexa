import Anthropic from '@anthropic-ai/sdk';
import { env } from '@nexa/config';
import { estimateCostMicros } from '../pricing.js';
import {
  AiProviderError,
  type AiProvider,
  type StepInput,
  type StepOutput,
  type StepUsage,
  type ToolCallRequest,
} from '../provider.js';

/**
 * Production provider.
 *
 * The model is given the tool specs the acting member is permitted to use and
 * nothing else. It cannot reach the database directly, cannot write SQL, and
 * cannot execute a consequential tool — the orchestrator converts those into
 * approval requests regardless of what the model asks for.
 *
 * Three operational decisions worth stating, because they are not obvious from
 * the call site:
 *
 *  1. **Every request streams.** Not because the UI consumes tokens
 *     incrementally — it does not, yet — but because a non-streaming request
 *     with a large `max_tokens` can sit on an idle connection long enough to
 *     hit an HTTP timeout and lose work that was already paid for. Streaming
 *     and then awaiting the assembled message costs nothing and removes that
 *     failure mode entirely.
 *  2. **The stable prefix is cached.** Tools render before the system prompt,
 *     so one `cache_control` marker on the final system block covers the tool
 *     schemas *and* the persona — the two largest and least variable parts of
 *     every request. In a tool-calling loop the same prefix is re-sent on each
 *     iteration, which is precisely the shape prompt caching is built for.
 *  3. **Failures are classified, not swallowed.** A bad API key and a
 *     momentary overload need different responses from the caller, so they
 *     arrive as different `AiProviderError` kinds instead of one generic throw.
 */
export class AnthropicAiProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  readonly generative = true;
  readonly model: string;

  private readonly client: Anthropic;
  private readonly effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  private readonly thinking: boolean;

  constructor(
    apiKey: string,
    options: {
      model?: string;
      maxRetries?: number;
      timeoutMs?: number;
      effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
      thinking?: boolean;
    } = {},
  ) {
    this.model = options.model ?? env.AI_MODEL;
    this.effort = options.effort ?? env.AI_EFFORT;
    this.thinking = options.thinking ?? env.AI_THINKING;
    this.client = new Anthropic({
      apiKey,
      // The SDK already backs off on 408/409/429/5xx. Three attempts is a
      // reasonable ceiling for a request a human is waiting on: beyond that the
      // honest answer is "try again", not a longer spinner.
      maxRetries: options.maxRetries ?? env.AI_MAX_RETRIES,
      timeout: options.timeoutMs ?? env.AI_TIMEOUT_MS,
    });
  }

  async step(input: StepInput): Promise<StepOutput> {
    let message: Anthropic.Message;
    try {
      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: env.AI_MAX_TOKENS,
        system: this.buildSystem(input.system),
        tools: this.buildTools(input.tools),
        messages: toAnthropicMessages(input),
        output_config: { effort: this.effort },
        // Adaptive thinking lets the model decide how much reasoning a question
        // deserves. "What was revenue yesterday?" should not pay for the same
        // deliberation as "why did margin fall this quarter?".
        ...(this.thinking ? { thinking: { type: 'adaptive' as const } } : {}),
      });
      message = await stream.finalMessage();
    } catch (error) {
      throw toProviderError(error);
    }

    if (message.stop_reason === 'refusal') {
      throw new AiProviderError(
        'The assistant declined to answer that request.',
        { kind: 'refusal', retryable: false },
      );
    }

    const usage = toStepUsage(this.model, message.usage);

    const toolCalls: ToolCallRequest[] = [];
    const textParts: string[] = [];
    for (const block of message.content) {
      if (block.type === 'text') textParts.push(block.text);
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    if (toolCalls.length > 0) {
      return {
        type: 'tool_calls',
        toolCalls,
        text: textParts.join('\n').trim() || undefined,
        // Thinking blocks are signed and must be replayed byte-for-byte on the
        // next request of this same turn. Hand the whole content array back to
        // the orchestrator as an opaque payload; only this provider reads it.
        providerBlocks: message.content,
        usage,
      };
    }

    if (message.stop_reason === 'max_tokens' && !textParts.join('').trim()) {
      throw new AiProviderError(
        'The assistant ran out of room before it produced an answer. Try a narrower question.',
        { kind: 'invalid_request', retryable: false },
      );
    }

    return { type: 'final', text: textParts.join('\n').trim(), usage };
  }

  /**
   * System prompt as a cacheable block. The marker sits on the last (only)
   * block, which caches the tool schemas rendered before it as well.
   */
  private buildSystem(system: string): Anthropic.TextBlockParam[] {
    return [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
  }

  private buildTools(tools: StepInput['tools']): Anthropic.ToolUnion[] {
    // Sorted by name so the serialised tool list is byte-identical between
    // requests — registry insertion order is not a stable cache key.
    return [...tools]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema as Anthropic.Tool.InputSchema,
      }));
  }
}

function toStepUsage(model: string, usage: Anthropic.Usage): StepUsage {
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costMicros: estimateCostMicros(model, { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }),
  };
}

/**
 * Maps SDK errors onto the vocabulary the API layer reasons about.
 *
 * The messages here are read by business owners, not engineers, so they say
 * what happened and what to do — never a status code or a stack.
 */
function toProviderError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;

  if (error instanceof Anthropic.AuthenticationError) {
    return new AiProviderError(
      'The AI service rejected this workspace’s credentials. An administrator needs to check the API key.',
      { kind: 'auth', retryable: false, status: error.status, cause: error },
    );
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new AiProviderError('This workspace’s AI credentials do not allow that model.', {
      kind: 'auth',
      retryable: false,
      status: error.status,
      cause: error,
    });
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new AiProviderError('The configured AI model is not available. Check AI_MODEL.', {
      kind: 'invalid_request',
      retryable: false,
      status: error.status,
      cause: error,
    });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiProviderError('The assistant is at capacity right now. Try again in a moment.', {
      kind: 'rate_limit',
      retryable: true,
      status: error.status,
      cause: error,
    });
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AiProviderError('The assistant could not process that request.', {
      kind: 'invalid_request',
      retryable: false,
      status: error.status,
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiProviderError('Could not reach the AI service. Check the server’s network connection.', {
      kind: 'network',
      retryable: true,
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIError) {
    const retryable = (error.status ?? 500) >= 500;
    return new AiProviderError(
      retryable
        ? 'The AI service is temporarily unavailable. Try again shortly.'
        : 'The assistant could not process that request.',
      { kind: retryable ? 'overloaded' : 'invalid_request', retryable, status: error.status, cause: error },
    );
  }

  return new AiProviderError('The assistant failed unexpectedly.', {
    kind: 'unknown',
    retryable: false,
    cause: error,
  });
}

function toAnthropicMessages(input: StepInput): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];
  for (const turn of input.turns) {
    if (turn.role === 'user') {
      messages.push({ role: 'user', content: turn.content });
      continue;
    }
    if (turn.role === 'assistant') {
      // Replay the provider's own blocks when we have them: they carry the
      // signed thinking the API requires back unmodified. Reconstructing the
      // turn from text + tool calls would silently drop that signature.
      const replay = turn.providerBlocks;
      if (Array.isArray(replay) && replay.length > 0) {
        messages.push({ role: 'assistant', content: replay as Anthropic.ContentBlockParam[] });
        continue;
      }
      const content: Anthropic.ContentBlockParam[] = [];
      if (turn.content.trim()) content.push({ type: 'text', text: turn.content });
      for (const toolCall of turn.toolCalls ?? []) {
        content.push({ type: 'tool_use', id: toolCall.id, name: toolCall.name, input: toolCall.input });
      }
      if (content.length > 0) messages.push({ role: 'assistant', content });
      continue;
    }
    messages.push({
      role: 'user',
      content: turn.results.map<Anthropic.ToolResultBlockParam>((result) => ({
        type: 'tool_result',
        tool_use_id: result.id,
        is_error: !result.ok,
        content: JSON.stringify({ summary: result.summary, data: result.data }).slice(0, 60_000),
      })),
    });
  }
  return messages;
}
