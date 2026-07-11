// Live agent status — what the dashboard's "agent" panel streams: who's running, their mood
// (→ an ASCII face), and the last thing they "said" (accumulated text from the current run).
// In-memory + single-process: the worker/cron/CEO update it as they stream.
export type AgentMood = "idle" | "thinking" | "building" | "researching" | "shipped" | "stuck";

export interface AgentStatus {
  name: string;
  mood: AgentMood;
  message: string;
  taskId: string | null;
}

let current: AgentStatus = { name: "polsia", mood: "idle", message: "", taskId: null };

export function getAgentStatus(): AgentStatus {
  return current;
}

export function setAgentStatus(patch: Partial<AgentStatus>): void {
  current = { ...current, ...patch };
}

export function idleAgent(message = ""): void {
  current = { name: "polsia", mood: "idle", message, taskId: null };
}

// Unified live activity ring — non-task agents (CEO, onboarding) have no task_events row, so they'd
// never reach the dashboard feed. They push here; the feed merges this with the DB task_events.
export interface Activity {
  ts: Date;
  actor: string;
  type: string;
  text: string;
}
const ring: Activity[] = [];

export function pushActivity(actor: string, type: string, payload: unknown): void {
  const text = typeof payload === "object" ? JSON.stringify(payload) : String(payload);
  ring.push({ ts: new Date(), actor, type, text: text.slice(0, 160) });
  if (ring.length > 300) ring.shift();
}

export function getActivity(): Activity[] {
  return ring;
}
