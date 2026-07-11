// Store interface (async) — the persistence seam. InMemoryStore for the guard test;
// PgStore (pg-store.ts) for the real platform. Worker/tools/spike depend only on this interface.
import { randomUUID } from "node:crypto";
import type { Task, TaskEvent, TaskPriority, TaskResult, TaskStatus, TaskTag } from "./types.ts";

export interface CreateTaskInput {
  companyId: string;
  title: string;
  description: string;
  tag: TaskTag;
  priority?: TaskPriority;
  /** Autonomous proposals start "suggested"; user/operator tasks start "todo". */
  status?: Extract<TaskStatus, "todo" | "suggested">;
}

export interface Store {
  create(input: CreateTaskInput): Promise<Task>;
  get(id: string): Promise<Task | undefined>;
  nextTodo(companyId: string): Promise<Task | undefined>;
  setStatus(id: string, status: TaskStatus, result?: TaskResult): Promise<void>;
  setPriority(id: string, priority: TaskPriority): Promise<void>;
  /** J.5: checkpoint a multi-execution task → needs_continuation + save the handoff note. */
  checkpoint(id: string, note: string): Promise<void>;
  event(taskId: string, actor: string, type: TaskEvent["type"], payload: unknown): Promise<void>;
  list(companyId: string, status?: TaskStatus): Promise<Task[]>;
}

/** In-memory implementation — used by the guard test (no DB needed). */
export class InMemoryStore implements Store {
  private tasks = new Map<string, Task>();

  async create(input: CreateTaskInput): Promise<Task> {
    const task: Task = {
      id: randomUUID().slice(0, 8),
      companyId: input.companyId,
      title: input.title,
      description: input.description,
      tag: input.tag,
      priority: input.priority ?? 1,
      status: input.status ?? "todo",
      events: [],
      createdAt: Date.now(),
    };
    this.tasks.set(task.id, task);
    await this.event(task.id, "system", "status_change", { to: task.status });
    return task;
  }
  async get(id: string) {
    return this.tasks.get(id);
  }
  async nextTodo(companyId: string) {
    for (const t of this.tasks.values()) if (t.companyId === companyId && t.status === "todo") return t;
    return undefined;
  }
  async setStatus(id: string, status: TaskStatus, result?: TaskResult) {
    const t = this.tasks.get(id);
    if (!t) return;
    t.status = status;
    if (result) t.result = result;
    await this.event(id, "system", "status_change", { to: status });
  }
  async setPriority(id: string, priority: TaskPriority) {
    const t = this.tasks.get(id);
    if (t) t.priority = priority;
  }
  async checkpoint(id: string, note: string) {
    const t = this.tasks.get(id);
    if (!t) return;
    t.status = "needs_continuation";
    t.resumeNote = note;
    await this.event(id, "system", "status_change", { to: "needs_continuation", resumeNote: note });
  }
  async event(taskId: string, actor: string, type: TaskEvent["type"], payload: unknown) {
    this.tasks.get(taskId)?.events.push({ ts: Date.now(), type, actor, payload });
  }
  async list(companyId: string, status?: TaskStatus) {
    return [...this.tasks.values()].filter((t) => t.companyId === companyId && (!status || t.status === status));
  }
}
