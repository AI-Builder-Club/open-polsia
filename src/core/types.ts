// Core domain types — runtime-agnostic (no pi dependency).
// Task model (Postgres-backed; schema in core/db.ts).

export type TaskStatus =
  | "suggested" // proposed by an autonomous agent; needs promotion (autonomy gate)
  | "todo"
  | "in_progress"
  | "completed"
  | "failed"
  | "needs_continuation" // multi-execution / ended without explicit completion (status guard)
  | "blocked"
  | "rejected";

export type TaskTag = "engineering" | "research";

/** 0 low · 1 medium · 2 high · 3 critical — the cron dispatches the highest first. */
export type TaskPriority = 0 | 1 | 2 | 3;

export interface TaskArtifact {
  type: "files" | "pr" | "deploy" | "report" | "inbox" | "note";
  ref: string; // path / url / id
  note?: string;
}

export interface TaskResult {
  summary: string;
  artifacts: TaskArtifact[];
}

export type TaskEventType =
  | "status_change"
  | "reasoning"
  | "tool_call"
  | "tool_result" // log tool RESULTS, not just calls
  | "agent_text"
  | "note";

export interface TaskEvent {
  ts: number;
  type: TaskEventType;
  actor: string; // agent name or "system"
  payload: unknown;
}

export interface Task {
  id: string;
  companyId: string;
  title: string;
  description: string; // carries intent (the "why") — the task's context channel
  tag: TaskTag;
  priority: TaskPriority;
  status: TaskStatus;
  result?: TaskResult;
  /** Handoff note written by resume_task at the end of a run; injected into the next run (J.5). */
  resumeNote?: string;
  events: TaskEvent[];
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
}

// Neutral, runtime-agnostic agent-event union (PiRuntime normalizes pi events to this).
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; args: unknown }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "final"; text: string }
  | { type: "error"; message: string };
