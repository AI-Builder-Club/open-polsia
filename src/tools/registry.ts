// Neutral tool registry — runtime-agnostic tool definitions + an adapter to pi.
// Defining tools once here (not as pi extensions) keeps the AgentRuntime swap thin.
import type { Static, TSchema } from "@sinclair/typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

export interface ToolContext {
  taskId: string;
  /** Emit a structured activity event (logged to the task timeline). */
  log: (type: "tool_call" | "tool_result", payload: unknown) => void;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
}

export interface ToolDef<P extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: P;
  execute(args: Static<P>, ctx: ToolContext): Promise<ToolResult>;
}

/** Adapt a neutral ToolDef to a pi ToolDefinition for a given task context. */
export function toPiTool<P extends TSchema>(def: ToolDef<P>, ctx: ToolContext) {
  return defineTool({
    name: def.name,
    label: def.name,
    description: def.description,
    parameters: def.parameters,
    promptSnippet: `${def.name} — ${def.description}`,
    async execute(_toolCallId, params) {
      ctx.log("tool_call", { name: def.name, args: params });
      const result = await def.execute(params as Static<P>, ctx);
      ctx.log("tool_result", { name: def.name, result });
      return {
        content: [{ type: "text" as const, text: result.summary }],
        details: result,
      };
    },
  });
}
