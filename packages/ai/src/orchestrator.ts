import type { AgentDefinition } from './agents.js';
import { buildSystemPrompt } from './agents.js';
import type { AiProvider, AiTurn, ToolCallOutcome, ToolCallRequest } from './provider.js';
import type { ToolRegistry } from './registry.js';
import type { ActionProposal, ToolContext, ToolDefinition } from './tool.js';
import { ToolError } from './tool.js';

/**
 * The orchestration loop.
 *
 * Invariants this function enforces, independent of what the model asks for:
 *
 *  - A tool the acting member lacks permission for is never executed.
 *  - Arguments are parsed by the tool's Zod schema before the handler sees them.
 *  - A tool marked `requiresApproval` is *never* executed here. It is turned
 *    into a proposal, returned to the caller for persistence, and the model is
 *    told only that a proposal was prepared.
 *  - The loop is bounded, so a model cannot spin on tool calls.
 */

const MAX_ITERATIONS = 4;

export interface RecordedToolCall {
  id: string;
  name: string;
  label: string;
  status: 'ok' | 'error';
  summary: string;
  arguments: Record<string, unknown>;
  durationMs: number;
}

export interface PendingProposal {
  toolCallId: string;
  tool: string;
  agentId: string;
  payload: Record<string, unknown>;
  proposal: ActionProposal;
}

export interface TurnResult {
  text: string;
  toolCalls: RecordedToolCall[];
  proposals: PendingProposal[];
  citations: Array<{ label: string; href: string }>;
  provider: 'mock' | 'anthropic';
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  latencyMs: number;
  /** The full transport history, persisted so the next turn has continuity. */
  turns: AiTurn[];
}

export interface RunTurnOptions {
  agent: AgentDefinition;
  registry: ToolRegistry;
  provider: AiProvider;
  context: ToolContext;
  /** Prior transport turns for this conversation, oldest first. */
  history: AiTurn[];
  message: string;
  businessMeta: { industry: string; country: string };
}

export async function runTurn(options: RunTurnOptions): Promise<TurnResult> {
  const { agent, registry, provider, context, message } = options;
  const startedAt = Date.now();

  const system = buildSystemPrompt(agent, {
    businessName: context.businessName,
    userName: context.userName,
    currency: context.currency,
    today: context.now.toISOString().slice(0, 10),
    industry: options.businessMeta.industry,
    country: options.businessMeta.country,
  });

  const specs = registry.specsFor(agent, context.permissions);
  const turns: AiTurn[] = [...options.history, { role: 'user', content: message }];

  const recordedCalls: RecordedToolCall[] = [];
  const proposals: PendingProposal[] = [];
  const citations: Array<{ label: string; href: string }> = [];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const step = await provider.step({
      system,
      turns,
      tools: specs,
      context: {
        currency: context.currency,
        locale: context.locale,
        businessName: context.businessName,
        userName: context.userName,
      },
    });

    if (step.type === 'final') {
      turns.push({ role: 'assistant', content: step.text });
      return {
        text: step.text,
        toolCalls: recordedCalls,
        proposals,
        citations: dedupeCitations(citations),
        provider: provider.name,
        model: provider.model,
        usage: step.usage,
        latencyMs: Date.now() - startedAt,
        turns,
      };
    }

    turns.push({ role: 'assistant', content: step.text ?? '', toolCalls: step.toolCalls });

    const outcomes: ToolCallOutcome[] = [];
    for (const request of step.toolCalls) {
      const { outcome, recorded, proposal } = await invokeTool({
        request,
        agent,
        registry,
        context,
        citations,
      });
      outcomes.push(outcome);
      recordedCalls.push(recorded);
      if (proposal) proposals.push(proposal);
    }
    turns.push({ role: 'tool_results', results: outcomes });
  }

  // The model kept requesting tools past the bound. Answer with what we have
  // rather than looping — and say so, instead of inventing a conclusion.
  const fallback =
    'I gathered the data but ran out of steps before composing a full answer. ' +
    'Here is what I retrieved: ' +
    recordedCalls.map((c) => c.summary).join(' ');
  turns.push({ role: 'assistant', content: fallback });
  return {
    text: fallback,
    toolCalls: recordedCalls,
    proposals,
    citations: dedupeCitations(citations),
    provider: provider.name,
    model: provider.model,
    latencyMs: Date.now() - startedAt,
    turns,
  };
}

async function invokeTool(args: {
  request: ToolCallRequest;
  agent: AgentDefinition;
  registry: ToolRegistry;
  context: ToolContext;
  citations: Array<{ label: string; href: string }>;
}): Promise<{ outcome: ToolCallOutcome; recorded: RecordedToolCall; proposal?: PendingProposal }> {
  const { request, agent, registry, context } = args;
  const startedAt = Date.now();
  const tool = registry.get(request.name);

  const fail = (summary: string): { outcome: ToolCallOutcome; recorded: RecordedToolCall } => ({
    outcome: { id: request.id, name: request.name, ok: false, summary, data: { error: summary } },
    recorded: {
      id: request.id,
      name: request.name,
      label: tool?.label ?? request.name,
      status: 'error',
      summary,
      arguments: request.input,
      durationMs: Date.now() - startedAt,
    },
  });

  if (!tool) return fail(`Unknown tool "${request.name}".`);
  if (!agent.tools.includes(tool.name)) {
    return fail(`The ${agent.name} is not authorised to use ${tool.label}.`);
  }
  if (!context.permissions.includes(tool.permission)) {
    return fail(`You do not have the "${tool.permission}" permission required for ${tool.label}.`);
  }

  const parsed = tool.schema.safeParse(request.input);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
    return fail(`Invalid arguments for ${tool.label} — ${detail}`);
  }

  try {
    if (tool.requiresApproval) {
      const proposal = await tool.propose!(parsed.data, context);
      const summary = `Prepared for approval: ${proposal.label}`;
      return {
        outcome: {
          id: request.id,
          name: request.name,
          ok: true,
          summary,
          data: {
            proposed: true,
            actionLabel: proposal.label,
            detail: proposal.description,
            itemCount: countItems(parsed.data),
          },
        },
        recorded: {
          id: request.id,
          name: request.name,
          label: tool.label,
          status: 'ok',
          summary,
          arguments: parsed.data as Record<string, unknown>,
          durationMs: Date.now() - startedAt,
        },
        proposal: {
          toolCallId: request.id,
          tool: tool.name,
          agentId: agent.id,
          payload: parsed.data as Record<string, unknown>,
          proposal,
        },
      };
    }

    const result = await tool.execute(parsed.data, context);
    if (result.citations) args.citations.push(...result.citations);
    return {
      outcome: { id: request.id, name: request.name, ok: true, summary: result.summary, data: result.data },
      recorded: {
        id: request.id,
        name: request.name,
        label: tool.label,
        status: 'ok',
        summary: result.summary,
        arguments: parsed.data as Record<string, unknown>,
        durationMs: Date.now() - startedAt,
      },
    };
  } catch (error) {
    const message = error instanceof ToolError ? error.message : 'The tool failed to run.';
    if (!(error instanceof ToolError)) {
      console.error(`[nexa:ai] tool ${tool.name} threw`, error);
    }
    return fail(message);
  }
}

function countItems(input: unknown): number | undefined {
  if (input && typeof input === 'object') {
    for (const value of Object.values(input as Record<string, unknown>)) {
      if (Array.isArray(value)) return value.length;
    }
  }
  return undefined;
}

function dedupeCitations(citations: Array<{ label: string; href: string }>): Array<{ label: string; href: string }> {
  const seen = new Set<string>();
  return citations.filter((citation) => {
    if (seen.has(citation.href)) return false;
    seen.add(citation.href);
    return true;
  });
}

/** Executes an approved action. Called by the API after a human decision. */
export async function executeApprovedAction(args: {
  registry: ToolRegistry;
  toolName: string;
  payload: unknown;
  context: ToolContext;
}): Promise<{ ok: boolean; summary: string }> {
  const tool: ToolDefinition | undefined = args.registry.get(args.toolName);
  if (!tool) return { ok: false, summary: `Unknown tool "${args.toolName}".` };
  if (!args.context.permissions.includes(tool.permission)) {
    return { ok: false, summary: `Missing "${tool.permission}" permission.` };
  }
  const parsed = tool.schema.safeParse(args.payload);
  if (!parsed.success) {
    return { ok: false, summary: 'The stored action payload is no longer valid.' };
  }
  try {
    const result = await tool.execute(parsed.data, args.context);
    return { ok: true, summary: result.summary };
  } catch (error) {
    const message = error instanceof ToolError ? error.message : 'The action failed to execute.';
    if (!(error instanceof ToolError)) console.error(`[nexa:ai] approved action ${args.toolName} threw`, error);
    return { ok: false, summary: message };
  }
}
