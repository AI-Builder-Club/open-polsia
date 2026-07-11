// The orchestrator (chat agent) toolset — the chat surface, minus recurring tasks.
// Read/manage the queue, run/inspect tasks, read reports, read/write company documents.
import { Type } from "@sinclair/typebox";
import type { Store } from "../core/store.ts";
import { db } from "../core/db.ts";
import {
  approveTask,
  editTask,
  queueCounts,
  recentReports,
} from "../core/queries.ts";
import { getDocument, upsertDocument } from "../core/memory.ts";
import type { ToolDef } from "./registry.ts";

const DOC_TYPES = ["mission", "product_overview", "tech_notes", "brand_voice", "user_research"] as const;
const TaskId = Type.String({ description: "task id" });

export function makeOrchestratorTools(store: Store, companyId: string, baseUrl: string): ToolDef[] {
  const t = (def: ToolDef) => def;

  return [
    t({
      name: "get_context",
      description: "Company info: name, profile, autonomy, available documents, report count, queue counts.",
      parameters: Type.Object({}),
      async execute() {
        const sql = db();
        const [co] = await sql<{ name: string; profile: unknown; autonomy: string }[]>`SELECT name, profile, autonomy FROM companies WHERE id=${companyId}`;
        const docs = await sql<{ type: string }[]>`SELECT type FROM documents WHERE company_id=${companyId} AND content<>''`;
        const [{ n: reportCount }] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM reports WHERE company_id=${companyId}`;
        const counts = await queueCounts(companyId);
        return { ok: true, summary: JSON.stringify({ company: co?.name, autonomy: co?.autonomy, profile: co?.profile, documents: docs.map((d) => d.type), reportCount, queue: counts }, null, 2) };
      },
    }),
    t({
      name: "get_tasks",
      description: "List current tasks (id, tag, priority, status, title). Use before creating to avoid duplicates.",
      parameters: Type.Object({ status: Type.Optional(Type.String()) }),
      async execute(raw) {
        const { status } = raw as { status?: string };
        const tasks = await store.list(companyId, status as never);
        const lines = tasks.map((x) => `${x.id} [${x.tag}] p${x.priority} ${x.status} — ${x.title}`).join("\n");
        return { ok: true, summary: lines || "(queue empty)" };
      },
    }),
    t({
      name: "get_task_details",
      description: "Full detail of one task: status, tag, priority, description, result summary, event count.",
      parameters: Type.Object({ task_id: TaskId }),
      async execute(raw) {
        const task = await store.get((raw as { task_id: string }).task_id);
        if (!task) return { ok: false, summary: "task not found" };
        return { ok: true, summary: JSON.stringify({ id: task.id, tag: task.tag, priority: task.priority, status: task.status, title: task.title, description: task.description, result: task.result?.summary, events: task.events.length, resumeNote: task.resumeNote }, null, 2) };
      },
    }),
    t({
      name: "create_task",
      description: "Queue work. tag engineering (code/app) or research (web). priority 0 low..3 critical. Description = what AND why.",
      parameters: Type.Object({ title: Type.String(), description: Type.String(), tag: Type.Union([Type.Literal("engineering"), Type.Literal("research")]), priority: Type.Optional(Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2), Type.Literal(3)])) }),
      async execute(raw) {
        const a = raw as { title: string; description: string; tag: "engineering" | "research"; priority?: 0 | 1 | 2 | 3 };
        const task = await store.create({ companyId, title: a.title, description: a.description, tag: a.tag, priority: a.priority ?? 1, status: "todo" });
        return { ok: true, summary: `Created ${task.id} [${task.tag}] p${task.priority}: ${task.title}`, data: { taskId: task.id } };
      },
    }),
    t({
      name: "edit_task",
      description: "Update a task's title, description, and/or priority.",
      parameters: Type.Object({ task_id: TaskId, title: Type.Optional(Type.String()), description: Type.Optional(Type.String()), priority: Type.Optional(Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2), Type.Literal(3)])) }),
      async execute(raw) {
        const a = raw as { task_id: string; title?: string; description?: string; priority?: number };
        await editTask(a.task_id, a);
        return { ok: true, summary: `Edited ${a.task_id}.` };
      },
    }),
    t({
      name: "reject_task",
      description: "Remove a task from the queue by id (duplicate / no longer needed).",
      parameters: Type.Object({ task_id: TaskId, reason: Type.Optional(Type.String()) }),
      async execute(raw) {
        const a = raw as { task_id: string; reason?: string };
        await store.setStatus(a.task_id, "rejected", { summary: a.reason ?? "rejected via chat", artifacts: [] });
        return { ok: true, summary: `Rejected ${a.task_id}.` };
      },
    }),
    t({
      name: "approve_task",
      description: "Approve a suggested task → todo (so the worker can run it).",
      parameters: Type.Object({ task_id: TaskId }),
      async execute(raw) {
        await approveTask((raw as { task_id: string }).task_id);
        return { ok: true, summary: `Approved (→ todo).` };
      },
    }),
    t({
      name: "move_task_to_top",
      description: "Bump a task to run next (sets critical priority).",
      parameters: Type.Object({ task_id: TaskId }),
      async execute(raw) {
        await store.setPriority((raw as { task_id: string }).task_id, 3);
        return { ok: true, summary: `Moved to top (priority=critical).` };
      },
    }),
    t({
      name: "reorder_task",
      description: "Reorder by setting a task's priority (0 low..3 critical) — the queue runs higher first.",
      parameters: Type.Object({ task_id: TaskId, priority: Type.Union([Type.Literal(0), Type.Literal(1), Type.Literal(2), Type.Literal(3)]) }),
      async execute(raw) {
        const a = raw as { task_id: string; priority: 0 | 1 | 2 | 3 };
        await store.setPriority(a.task_id, a.priority);
        return { ok: true, summary: `Reordered ${a.task_id} → p${a.priority}.` };
      },
    }),
    t({
      name: "get_task_run_link",
      description: "Get a clickable URL that runs a specific task on click.",
      parameters: Type.Object({ task_id: TaskId }),
      async execute(raw) {
        const id = (raw as { task_id: string }).task_id;
        return { ok: true, summary: `${baseUrl}/run/${id}`, data: { url: `${baseUrl}/run/${id}` } };
      },
    }),
    t({
      name: "get_task_execution_status",
      description: "Is a task currently running? Returns its status.",
      parameters: Type.Object({ task_id: TaskId }),
      async execute(raw) {
        const task = await store.get((raw as { task_id: string }).task_id);
        if (!task) return { ok: false, summary: "task not found" };
        return { ok: true, summary: `${task.id}: ${task.status}${task.status === "in_progress" ? " (RUNNING)" : ""}` };
      },
    }),
    t({
      name: "get_task_execution_logs",
      description: "What the agent did on a task, step by step (recent events).",
      parameters: Type.Object({ task_id: TaskId, limit: Type.Optional(Type.Number()) }),
      async execute(raw) {
        const a = raw as { task_id: string; limit?: number };
        const task = await store.get(a.task_id);
        if (!task) return { ok: false, summary: "task not found" };
        const evs = task.events.slice(-(a.limit ?? 30));
        const lines = evs.map((e) => `${new Date(e.ts).toISOString().slice(11, 19)} ${e.actor} ${e.type} ${typeof e.payload === "object" ? JSON.stringify(e.payload).slice(0, 100) : e.payload}`).join("\n");
        return { ok: true, summary: lines || "(no events)" };
      },
    }),
    t({
      name: "get_active_executions",
      description: "What's running right now across all agents.",
      parameters: Type.Object({}),
      async execute() {
        const running = (await store.list(companyId)).filter((x) => x.status === "in_progress");
        return { ok: true, summary: running.length ? running.map((x) => `${x.id} [${x.tag}] — ${x.title}`).join("\n") : "(nothing running)" };
      },
    }),
    t({
      name: "find_best_agent",
      description: "Recommend the best agent tag for a task description.",
      parameters: Type.Object({ query: Type.String() }),
      async execute(raw) {
        const q = (raw as { query: string }).query.toLowerCase();
        const research = /(research|survey|compare|find out|investigate|competitor|market|read|web)/.test(q);
        const tag = research ? "research" : "engineering";
        return { ok: true, summary: `recommended_agent: ${tag} (heuristic — no historical outcomes ledger yet; Phase 4)` };
      },
    }),
    t({
      name: "query_reports",
      description: "List recent saved reports (CEO summaries, research deliverables).",
      parameters: Type.Object({ limit: Type.Optional(Type.Number()) }),
      async execute(raw) {
        const reps = await recentReports(companyId, (raw as { limit?: number }).limit ?? 5);
        return { ok: true, summary: reps.map((r) => `#${r.id} [${r.type}] ${r.name} — ${r.content.slice(0, 120)}`).join("\n\n") || "(no reports)" };
      },
    }),
    t({
      name: "get_document",
      description: `Read a company document. Types: ${DOC_TYPES.join(", ")}.`,
      parameters: Type.Object({ type: Type.String() }),
      async execute(raw) {
        const content = await getDocument(companyId, (raw as { type: string }).type);
        return { ok: true, summary: content ?? "(empty / not set)" };
      },
    }),
    t({
      name: "update_document",
      description: `Write/overwrite a company document. Types: ${DOC_TYPES.join(", ")}.`,
      parameters: Type.Object({ type: Type.String(), content: Type.String() }),
      async execute(raw) {
        const a = raw as { type: string; content: string };
        await upsertDocument(companyId, a.type, a.content);
        return { ok: true, summary: `Updated document "${a.type}".` };
      },
    }),
  ];
}
