import type { Permission } from '@nexa/types';
import { z } from 'zod';

/**
 * The AI tool contract.
 *
 * Two rules make this layer safe:
 *
 *  1. The model never writes SQL and never touches the database. It may only
 *     select a tool name and produce arguments, which are validated by that
 *     tool's Zod schema before any handler runs.
 *  2. A tool declares the `permission` it consumes and whether it
 *     `requiresApproval`. Permission is checked against the *acting member's*
 *     role, so the AI can never exceed the rights of the human it works for,
 *     and consequential tools are proposed rather than executed.
 */

export interface ToolContext {
  businessId: string;
  businessName: string;
  userId: string;
  userName: string;
  permissions: readonly Permission[];
  currency: string;
  locale: string;
  timezone: string;
  now: Date;
}

export interface ToolResult<TData = unknown> {
  /** One-line, human-readable summary shown in the tool-call trace. */
  summary: string;
  /** Structured payload handed back to the model. Must come from the database. */
  data: TData;
  /** Deep links the assistant can offer the user. */
  citations?: Array<{ label: string; href: string }>;
}

export interface ActionProposal {
  label: string;
  description: string;
  preview: Array<{ label: string; value: string }>;
  impact: 'low' | 'medium' | 'high';
}

export type ToolKind = 'read' | 'write';

export interface ToolDefinition<TSchema extends z.ZodType = z.ZodType> {
  name: string;
  label: string;
  /** Written for the model: says what the tool returns and when to reach for it. */
  description: string;
  schema: TSchema;
  kind: ToolKind;
  permission: Permission;
  /**
   * Consequential tools set this. The orchestrator will build a proposal and
   * stop; execution only happens after a human with `ai:approve_actions`
   * approves the recorded ai_action.
   */
  requiresApproval: boolean;
  /** Executes the tool. For write tools this runs only post-approval. */
  execute: (input: z.infer<TSchema>, ctx: ToolContext) => Promise<ToolResult>;
  /** Describes what *would* happen, for the approval card. */
  propose?: (input: z.infer<TSchema>, ctx: ToolContext) => Promise<ActionProposal>;
}

export function defineTool<TSchema extends z.ZodType>(definition: ToolDefinition<TSchema>): ToolDefinition<TSchema> {
  if (definition.requiresApproval && !definition.propose) {
    throw new Error(`Tool "${definition.name}" requires approval but has no propose() implementation.`);
  }
  return definition;
}

export class ToolError extends Error {
  constructor(
    readonly code: 'invalid_input' | 'forbidden' | 'not_found' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

/** Shape handed to a model provider so it can advertise callable tools. */
export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export function toToolSpec(tool: ToolDefinition): ToolSpec {
  const jsonSchema = z.toJSONSchema(tool.schema, { io: 'input', target: 'draft-7' }) as Record<string, unknown>;
  // Anthropic requires an object-typed root schema.
  const input_schema =
    jsonSchema.type === 'object' ? jsonSchema : { type: 'object', properties: {}, additionalProperties: false };
  return {
    name: tool.name,
    description:
      tool.description +
      (tool.requiresApproval ? ' NOTE: this action is proposed for human approval, never executed directly.' : ''),
    input_schema,
  };
}
