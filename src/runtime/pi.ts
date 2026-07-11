// PiRuntime — wraps the pi coding-agent SDK (createAgentSession), verified against v0.80.2.
// Pure: (system, prompt, tools) -> neutral AgentEvent stream. Stateless (SessionManager.inMemory()).
// noTools:"all" → no host bash/file leakage; the agent only gets our explicit (sandbox-backed) tools.
import { mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  SessionManager,
  DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "../core/types.ts";
import type { AgentRuntime, RunOpts } from "./types.ts";
import { toPiTool } from "../tools/registry.ts";

// Neutral, empty cwd so pi doesn't leak the host project into the agent's
// context — our agents never use pi's own cwd/file tools (they use sandbox-backed/custom tools),
// so the only company identity an agent sees is what memoryLoader injects.
const NEUTRAL_CWD = join(tmpdir(), "polsia-agent-cwd");
mkdirSync(NEUTRAL_CWD, { recursive: true });

export class PiRuntime implements AgentRuntime {
  async *run(opts: RunOpts): AsyncIterable<AgentEvent> {
    const queue: AgentEvent[] = [];
    let wake: (() => void) | null = null;
    let done = false;
    const push = (e: AgentEvent) => {
      queue.push(e);
      wake?.();
      wake = null;
    };

    const customTools = opts.tools.map((t) => toPiTool(t, opts.toolCtx));

    const { session } = await createAgentSession({
      cwd: NEUTRAL_CWD,
      sessionManager: SessionManager.inMemory(NEUTRAL_CWD),
      resourceLoader: new DefaultResourceLoader({
        cwd: NEUTRAL_CWD,
        agentDir: join(homedir(), ".pi", "agent"),
        systemPrompt: opts.system,
        noExtensions: true,
        noSkills: true,
        noContextFiles: true,
        noPromptTemplates: true,
        noThemes: true,
      }),
      // Allowlist = ONLY our custom tools by name. This enables them while excluding the
      // built-in read/bash/edit/write (so the orchestrator truly has no host shell/filesystem).
      tools: opts.tools.map((t) => t.name),
      customTools,
    });

    const unsub = session.subscribe((ev: unknown) => {
      const e = ev as {
        type?: string;
        assistantMessageEvent?: { type?: string; delta?: string };
      };
      if (e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta") {
        push({ type: "text", text: e.assistantMessageEvent.delta ?? "" });
      } else if (e.type === "agent_end") {
        done = true;
        push({ type: "final", text: "" });
      }
    });

    opts.signal?.addEventListener("abort", () => void session.abort());

    void session.prompt(opts.prompt).catch((err: unknown) => {
      push({ type: "error", message: err instanceof Error ? err.message : String(err) });
      done = true;
    });

    try {
      while (!done || queue.length > 0) {
        if (queue.length === 0) await new Promise<void>((r) => (wake = r));
        while (queue.length > 0) yield queue.shift()!;
      }
    } finally {
      unsub();
      session.dispose();
    }
  }
}
