import type { ToolSpec } from './tool.js';

/**
 * Provider-agnostic conversation transport.
 *
 * The orchestrator owns the tool-execution loop and speaks this vocabulary to
 * whichever provider is configured. Swapping MockAiProvider for the Anthropic
 * provider changes no application code — only AI_PROVIDER in the environment.
 */

export interface ToolCallRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolCallOutcome {
  id: string;
  name: string;
  ok: boolean;
  summary: string;
  /** Structured tool output. For failures this carries the error message. */
  data: unknown;
}

export type AiTurn =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: ToolCallRequest[];
      /**
       * Opaque, provider-owned content blocks for this turn.
       *
       * Reasoning models return signed thinking blocks alongside their tool
       * calls and require them echoed back verbatim on the following request —
       * an edited or missing block is rejected. Rather than teach the transport
       * about thinking, the provider stashes its own representation here and is
       * the only thing that ever reads it. Providers that have no such concept
       * (the mock) simply never set it.
       *
       * This is deliberately *not* persisted across turns: it matters only
       * within a single tool-calling loop, and the stored transcript is text.
       */
      providerBlocks?: unknown;
    }
  | { role: 'tool_results'; results: ToolCallOutcome[] };

export interface StepInput {
  system: string;
  turns: AiTurn[];
  tools: ToolSpec[];
  context: {
    currency: string;
    locale: string;
    businessName: string;
    userName: string;
  };
}

/** Token counts for one provider round trip, plus the derived cost estimate. */
export interface StepUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Estimated spend in integer micro-USD. Never presented as a billed amount. */
  costMicros: number;
}

export type StepOutput =
  | {
      type: 'tool_calls';
      toolCalls: ToolCallRequest[];
      text?: string;
      providerBlocks?: unknown;
      usage?: StepUsage;
    }
  | { type: 'final'; text: string; usage?: StepUsage };

export interface AiProvider {
  readonly name: 'mock' | 'anthropic';
  readonly model: string;
  /** Whether responses are composed by a real model. Surfaced in the UI. */
  readonly generative: boolean;
  step(input: StepInput): Promise<StepOutput>;
}

/**
 * A provider failure that the API layer can turn into an honest message.
 *
 * `retryable` distinguishes "the provider is busy, try again" from "this
 * request will never succeed as written" so callers do not retry into a wall.
 */
export class AiProviderError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly kind: 'auth' | 'rate_limit' | 'overloaded' | 'invalid_request' | 'refusal' | 'network' | 'unknown';

  constructor(
    message: string,
    options: { kind: AiProviderError['kind']; retryable: boolean; status?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'AiProviderError';
    this.kind = options.kind;
    this.retryable = options.retryable;
    this.status = options.status;
  }
}

export function emptyUsage(): StepUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicros: 0 };
}

/** Sums per-step usage so a multi-tool turn reports what it actually cost. */
export function addUsage(total: StepUsage, step: StepUsage | undefined): StepUsage {
  if (!step) return total;
  return {
    inputTokens: total.inputTokens + step.inputTokens,
    outputTokens: total.outputTokens + step.outputTokens,
    cacheReadTokens: total.cacheReadTokens + step.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens + step.cacheWriteTokens,
    costMicros: total.costMicros + step.costMicros,
  };
}
