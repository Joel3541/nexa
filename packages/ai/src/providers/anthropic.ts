import Anthropic from '@anthropic-ai/sdk';
import { env } from '@nexa/config';
import type { AiProvider, StepInput, StepOutput, ToolCallRequest } from '../provider.js';

/**
 * Production provider.
 *
 * The model is given the tool specs the acting member is permitted to use and
 * nothing else. It cannot reach the database directly, cannot write SQL, and
 * cannot execute a consequential tool — the orchestrator converts those into
 * approval requests regardless of what the model asks for.
 */
export class AnthropicAiProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  readonly generative = true;
  readonly model: string;

  private readonly client: Anthropic;

  constructor(apiKey: string, model: string = env.AI_MODEL) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async step(input: StepInput): Promise<StepOutput> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: env.AI_MAX_TOKENS,
      system: input.system,
      tools: input.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema as Anthropic.Tool.InputSchema,
      })),
      messages: toAnthropicMessages(input),
    });

    const toolCalls: ToolCallRequest[] = [];
    const textParts: string[] = [];
    for (const block of response.content) {
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
      return { type: 'tool_calls', toolCalls, text: textParts.join('\n').trim() || undefined };
    }

    return {
      type: 'final',
      text: textParts.join('\n').trim(),
      usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
    };
  }
}

function toAnthropicMessages(input: StepInput): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];
  for (const turn of input.turns) {
    if (turn.role === 'user') {
      messages.push({ role: 'user', content: turn.content });
      continue;
    }
    if (turn.role === 'assistant') {
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
