// Task tools. Split by privilege:
//  - create_task  → orchestrator only (user-authorized) → status "todo"
//  - complete_task / fail_task → execution agents assert their OWN terminal state
import { Type } from "@sinclair/typebox";
import type { Store } from "../core/store.ts";
import type { TaskArtifact, TaskTag } from "../core/types.ts";
import type { ToolDef } from "./registry.ts";

/** Operator-authorized creation → status "todo" (ready to run). */
export function makeCreateTaskTool(store: Store, companyId: string, onCreate?: () => void): ToolDef {
  return {
    name: "create_task",
    description:
      "Queue a unit of work for an execution agent. Routes by tag. Write a clear description capturing intent.",
    parameters: Type.Object({
      title: Type.String(),
      description: Type.String({ description: "What to do AND why — the agent only sees this." }),
      tag: Type.Union([Type.Literal("engineering"), Type.Literal("research")]),
    }),
    async execute(raw) {
      const args = raw as { title: string; description: string; tag: TaskTag };
      const task = await store.create({
        companyId,
        title: args.title,
        description: args.description,
        tag: args.tag,
        status: "todo",
      });
      onCreate?.();
      return { ok: true, summary: `Created task ${task.id} [${task.tag}]: ${task.title}`, data: { taskId: task.id } };
    },
  };
}

/** Read the queue — so the orchestrator can answer "what's queued?" and avoid duplicates. */
export function makeListTasksTool(store: Store, companyId: string): ToolDef {
  return {
    name: "get_tasks",
    description:
      "List current tasks (id, tag, priority, status, title). Call BEFORE creating a task to check for duplicates, or to answer questions about the queue.",
    parameters: Type.Object({}),
    async execute() {
      const tasks = await store.list(companyId);
      const lines = tasks
        .map((t) => `${t.id} [${t.tag}] p${t.priority} ${t.status} — ${t.title}`)
        .join("\n");
      return { ok: true, summary: tasks.length ? lines : "(queue is empty)", data: { count: tasks.length } };
    },
  };
}

/** Remove a task from the queue by id (duplicate / no longer needed). */
export function makeRejectTaskByIdTool(store: Store): ToolDef {
  return {
    name: "reject_task",
    description: "Remove a task from the queue by id (e.g. duplicate, replaced, or no longer needed).",
    parameters: Type.Object({ task_id: Type.String(), reason: Type.Optional(Type.String()) }),
    async execute(raw) {
      const { task_id, reason } = raw as { task_id: string; reason?: string };
      await store.setStatus(task_id, "rejected", { summary: reason ?? "rejected via chat", artifacts: [] });
      return { ok: true, summary: `Rejected ${task_id}.` };
    },
  };
}

/** Change a task's priority (0 low … 3 critical) so the worker reorders. */
export function makeSetPriorityTool(store: Store): ToolDef {
  return {
    name: "set_priority",
    description: "Change a task's priority (0 low, 1 medium, 2 high, 3 critical). The worker runs higher first.",
    parameters: Type.Object({
      task_id: Type.String(),
      priority: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2), Type.Literal(3)]),
    }),
    async execute(raw) {
      const { task_id, priority } = raw as { task_id: string; priority: 0 | 1 | 2 | 3 };
      await store.setPriority(task_id, priority);
      return { ok: true, summary: `Set ${task_id} priority = ${priority}.` };
    },
  };
}

/** Autonomous-agent creation → status "suggested" (needs promotion via the autonomy gate). */
export function makeProposeTaskTool(store: Store, companyId: string): ToolDef {
  return {
    name: "create_task_proposal",
    description:
      "Propose a unit of work (enters the queue as 'suggested'). Routes by tag. Set priority so the cron runs the most important first.",
    parameters: Type.Object({
      title: Type.String(),
      description: Type.String(),
      tag: Type.Union([Type.Literal("engineering"), Type.Literal("research")]),
      priority: Type.Optional(
        Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2), Type.Literal(3)], {
          description: "0 low · 1 medium · 2 high · 3 critical",
        }),
      ),
    }),
    async execute(raw) {
      const args = raw as { title: string; description: string; tag: TaskTag; priority?: 0 | 1 | 2 | 3 };
      const task = await store.create({
        companyId,
        title: args.title,
        description: args.description,
        tag: args.tag,
        priority: args.priority ?? 1,
        status: "suggested",
      });
      return { ok: true, summary: `Proposed task ${task.id} [${task.tag}]: ${task.title}`, data: { taskId: task.id } };
    },
  };
}

const ArtifactSchema = Type.Object({
  type: Type.Union([
    Type.Literal("files"),
    Type.Literal("pr"),
    Type.Literal("deploy"),
    Type.Literal("report"),
    Type.Literal("inbox"),
    Type.Literal("note"),
  ]),
  ref: Type.String(),
  note: Type.Optional(Type.String()),
});

export function makeCompleteTaskTool(store: Store): ToolDef {
  return {
    name: "complete_task",
    description:
      "Mark THIS task completed. Only call after the deliverable exists (files written / app scaffolded).",
    parameters: Type.Object({
      summary: Type.String(),
      artifacts: Type.Array(ArtifactSchema),
    }),
    async execute(raw, ctx) {
      const args = raw as { summary: string; artifacts: TaskArtifact[] };
      await store.setStatus(ctx.taskId, "completed", {
        summary: args.summary,
        artifacts: args.artifacts,
      });
      return { ok: true, summary: `Task ${ctx.taskId} marked completed.` };
    },
  };
}

/** J.5 checkpoint: not finished this run → needs_continuation + handoff note for the next run. */
export function makeResumeTaskTool(store: Store): ToolDef {
  return {
    name: "resume_task",
    description:
      "Call this when you've made progress but the task is NOT finished this run. Saves a note for your next run (which resumes in the same workspace). Use instead of complete_task when more runs are needed.",
    parameters: Type.Object({
      note: Type.String({ description: "What you did, and exactly what the next run should do to continue." }),
    }),
    async execute(raw, ctx) {
      const args = raw as { note: string };
      await store.checkpoint(ctx.taskId, args.note);
      return { ok: true, summary: `Task ${ctx.taskId} checkpointed for continuation.` };
    },
  };
}

export function makeFailTaskTool(store: Store): ToolDef {
  return {
    name: "fail_task",
    description: "Mark THIS task failed when you cannot produce the deliverable. Explain why.",
    parameters: Type.Object({ reason: Type.String() }),
    async execute(raw, ctx) {
      const args = raw as { reason: string };
      await store.setStatus(ctx.taskId, "failed", { summary: args.reason, artifacts: [] });
      return { ok: true, summary: `Task ${ctx.taskId} marked failed.` };
    },
  };
}
