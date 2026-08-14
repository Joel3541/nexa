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
  | { role: 'assistant'; content: string; toolCalls?: ToolCallRequest[] }
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

export type StepOutput =
  | { type: 'tool_calls'; toolCalls: ToolCallRequest[]; text?: string }
  | { type: 'final'; text: string; usage?: { inputTokens?: number; outputTokens?: number } };

export interface AiProvider {
  readonly name: 'mock' | 'anthropic';
  readonly model: string;
  /** Whether responses are composed by a real model. Surfaced in the UI. */
  readonly generative: boolean;
  step(input: StepInput): Promise<StepOutput>;
}
