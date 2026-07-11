// AgentRuntime — the swap seam (PiRuntime now; ClaudeAgentSdkRuntime later).
// Pure: (system, prompt, tools) -> event stream. Sandbox isolation is an implementation detail
// of the tools themselves (the engineering agent's bash/file tools route through Sandbox.exec),
// so the runtime never needs to know about sandboxes.
import type { AgentEvent } from "../core/types.ts";
import type { ToolContext, ToolDef } from "../tools/registry.ts";

export interface RunOpts {
  system: string; // full custom system prompt
  prompt: string; // the task/user message
  tools: ToolDef[]; // the agent's scoped tool set (already bound to its sandbox if any)
  toolCtx: ToolContext; // activity-log sink + current taskId
  model?: string;
  signal?: AbortSignal;
}

export interface AgentRuntime {
  run(opts: RunOpts): AsyncIterable<AgentEvent>;
}
