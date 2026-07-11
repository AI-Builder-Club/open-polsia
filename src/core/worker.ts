// Worker — pulls a todo task, runs the tagged execution agent in a sandbox, and enforces the
// Status integrity rule: NEVER auto-complete. If the agent didn't assert a terminal
// state, the task ends as needs_continuation (paused/incomplete) — not completed.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRuntime } from "../runtime/types.ts";
import { createSandbox } from "../sandbox/factory.ts";
import { db } from "./db.ts";
import { getSandboxId, setSandboxId } from "./queries.ts";
import type { ToolContext } from "../tools/registry.ts";
import { agents } from "../agents/index.ts";
import { withCompanyContext } from "./memory.ts";
import { setAgentStatus, idleAgent } from "./status.ts";
import type { Store } from "./store.ts";
import type { Task, TaskStatus } from "./types.ts";

const TEMPLATE_DIR = join(fileURLToPath(new URL("../../templates/express-postgres", import.meta.url)));
const WORKSPACES_DIR = join(fileURLToPath(new URL("../../workspaces", import.meta.url)));

/** Stable, discoverable location for a task's built app: workspaces/<taskId>/ */
export function workspaceDir(taskId: string): string {
  return join(WORKSPACES_DIR, taskId);
}

/**
 * Run a task to FULL completion: if the agent checkpoints (needs_continuation), resume
 * it IMMEDIATELY — run after run, same sitting — until it completes/fails, capped at maxRuns to
 * avoid runaway cost. Returns the final status.
 */
export async function runToCompletion(
  store: Store,
  runtime: AgentRuntime,
  taskId: string,
  maxRuns = 5,
): Promise<TaskStatus> {
  for (let i = 0; i < maxRuns; i++) {
    const t = await store.get(taskId);
    if (!t) return "failed";
    if (["completed", "failed", "blocked", "rejected"].includes(t.status)) return t.status;
    await runTask(store, runtime, t);
    const after = await store.get(taskId);
    if (after?.status !== "needs_continuation") return after?.status ?? "failed";
    // else: resume immediately (next loop iteration)
  }
  return "needs_continuation"; // hit the resume cap — left for a human to look at
}

export async function runTask(store: Store, runtime: AgentRuntime, task: Task): Promise<void> {
  await store.setStatus(task.id, "in_progress");
  const toolCtx: ToolContext = {
    taskId: task.id,
    log: (type, payload) => void store.event(task.id, task.tag, type, payload),
  };

  // RESEARCH — no sandbox: web search → save report → complete (Spec: agent 29).
  if (task.tag === "research") {
    setAgentStatus({ name: "research", mood: "researching", message: `Researching: ${task.title}`, taskId: task.id });
    const tools = agents.research.makeTools({ store, companyId: task.companyId });
    let buf = "";
    for await (const ev of runtime.run({
      system: await withCompanyContext(task.companyId, agents.research.prompt),
      prompt: `Task #${task.id}: ${task.title}\n\n${task.description}`,
      tools,
      toolCtx,
    })) {
      if (ev.type === "text") { process.stdout.write(ev.text); buf += ev.text; setAgentStatus({ message: buf.slice(-800) }); }
      if (ev.type === "error") await store.event(task.id, "system", "note", { error: ev.message });
    }
    idleAgent();
    const rt = (await store.get(task.id))!;
    if (rt.status === "in_progress") {
      await store.setStatus(task.id, "needs_continuation", {
        summary: "Research run ended without asserting completion.",
        artifacts: [],
      });
    }
    return;
  }

  const wdir = workspaceDir(task.id);
  // Option A: one persistent sandbox per company — reconnect to the stored id (warm, deps preserved),
  // else create fresh. (Local Docker ignores the id and persists via the host dir.)
  const storedSandboxId = await getSandboxId(task.companyId);
  const sandbox = await createSandbox({ hostDir: wdir, sandboxId: storedSandboxId });
  const sid = sandbox.id();
  if (sid && sid !== storedSandboxId) await setSandboxId(task.companyId, sid); // persist a newly-created id
  // RESUME (J.5): if the workspace already has prior work, do NOT re-seed the template.
  const isResume = !(await sandbox.isEmpty());
  try {
    if (!isResume) {
      // First run: seed the starter template into the sandbox workdir.
      await sandbox.seed(TEMPLATE_DIR);
    }
    await store.event(task.id, "system", "note", { workdir: sandbox.workdir(), resume: isResume });

    // deploy_app pushes from the host workspace dir (local Docker) or from inside the remote
    // sandbox itself (Daytona) — the agent can deploy in both modes.
    const [co] = await db()<{ slug: string }[]>`SELECT slug FROM companies WHERE id = ${task.companyId}`;
    const deploySource = process.env.SANDBOX_PROVIDER === "daytona" ? { sandbox } : { dir: wdir };

    const tools = agents.engineering.makeTools({
      sandbox,
      store,
      deploy: co ? { companyId: task.companyId, slug: co.slug, source: deploySource } : undefined,
    });

    // On resume, inject the prior run's handoff note so the agent continues, not restarts.
    const continuation = isResume && task.resumeNote
      ? `\n\n[CONTINUATION — run again in the SAME workspace] Your previous run's note:\n${task.resumeNote}\nThe workspace already contains your prior work — read it (ls), then continue. Call complete_task when fully done, or resume_task again if more runs are needed.`
      : "";

    setAgentStatus({ name: "engineering", mood: "building", message: `${isResume ? "Continuing" : "Building"}: ${task.title}`, taskId: task.id });
    let buf = "";
    for await (const ev of runtime.run({
      system: await withCompanyContext(task.companyId, agents.engineering.prompt),
      prompt: `Task #${task.id}: ${task.title}\n\n${task.description}${continuation}`,
      tools,
      toolCtx,
    })) {
      if (ev.type === "text") { process.stdout.write(ev.text); buf += ev.text; setAgentStatus({ message: buf.slice(-800) }); }
      if (ev.type === "error") await store.event(task.id, "system", "note", { error: ev.message });
    }
    idleAgent();

    // STATUS INTEGRITY GUARD: the agent must have asserted completed/failed.
    const t = (await store.get(task.id))!;
    if (t.status === "in_progress") {
      await store.setStatus(task.id, "needs_continuation", {
        summary: "Agent ended without asserting complete_task/fail_task — not auto-completed.",
        artifacts: [],
      });
    }
  } finally {
    await sandbox.release(); // preserve state for next time (docker: host dir; daytona: stop+archive)
  }
}
