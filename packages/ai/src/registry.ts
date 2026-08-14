import type { Permission } from '@nexa/types';
import type { AgentDefinition } from './agents.js';
import { type ToolDefinition, type ToolSpec, toToolSpec } from './tool.js';

/**
 * Central tool registry.
 *
 * The registry is the only place that knows which tools exist. Both the model
 * providers and the approval endpoint resolve tools through it, so a tool that
 * is not registered simply cannot be invoked by anything.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered.`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  registerAll(tools: ToolDefinition[]): this {
    for (const tool of tools) this.register(tool);
    return this;
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  all(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /**
   * Tools the given agent is allowed to use, further narrowed to those the
   * acting member actually has permission for. Both filters must pass.
   */
  availableFor(agent: AgentDefinition, permissions: readonly Permission[]): ToolDefinition[] {
    return this.all().filter(
      (tool) => agent.tools.includes(tool.name) && permissions.includes(tool.permission),
    );
  }

  specsFor(agent: AgentDefinition, permissions: readonly Permission[]): ToolSpec[] {
    return this.availableFor(agent, permissions).map(toToolSpec);
  }
}

export const toolRegistry = new ToolRegistry();
