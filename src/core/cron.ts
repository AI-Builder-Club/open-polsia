// The daily cron — the autonomous beat (one mode; supervised/full removed).
//   1. promote the top-priority `suggested` proposal → `todo`, run it to FULL completion
//      (resuming immediately as needed, capped).
//   2. ONLY IF it actually completed → CEO review → report → propose + (re)prioritize the backlog.
// The CEO review is local to THIS cron — ad-hoc chat tasks completing during the day do NOT trigger it.
import type { AgentRuntime } from "../runtime/types.ts";
import type { Store } from "./store.ts";
import { nextProposal } from "./queries.ts";
import { runToCompletion } from "./worker.ts";
import { runCeoCycle } from "../agents/ceo.ts";
import type { TaskStatus } from "./types.ts";

export interface DailyCronResult {
  ranTaskId: string | null;
  taskStatus: TaskStatus | null;
  report?: string;
  ceoRan: boolean;
}

export async function runDailyCron(
  store: Store,
  runtime: AgentRuntime,
  companyId: string,
): Promise<DailyCronResult> {
  // 1. Run the top proposal to completion (resumes itself; finishes in-flight before anything new).
  const id = await nextProposal(companyId);
  let taskStatus: TaskStatus | null = null;
  if (id) taskStatus = await runToCompletion(store, runtime, id);

  // 2. CEO review — only when the cron's task actually completed (or there was nothing to run,
  //    so the CEO still reviews state + replans). Skip review if the task is still mid-flight.
  if (taskStatus === "completed" || taskStatus === null) {
    const { report } = await runCeoCycle(store, runtime, companyId);
    return { ranTaskId: id, taskStatus, report, ceoRan: true };
  }
  return { ranTaskId: id, taskStatus, ceoRan: false };
}
