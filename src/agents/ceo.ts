// CEO / Planner — the autonomy loop. The def is the agent (prompt + its three tools:
// read_state · create_task_proposal · write_report); runCeoCycle is the scheduled DRIVER: read
// state → keep backlog >= 3 (proposals land as "suggested") → write the daily report. The autonomy
// gate then promotes suggested→todo if the company is on full autonomy. Tags limited to
// engineering/research; no infra logs / owner email / ads / task-metadata yet.
import { Type } from "@sinclair/typebox";
import type { AgentRuntime } from "../runtime/types.ts";
import type { Store } from "../core/store.ts";
import type { ToolContext, ToolDef } from "../tools/registry.ts";
import type { AgentDef } from "./types.ts";
import { makeProposeTaskTool } from "../tools/tasks.ts";
import { db } from "../core/db.ts";
import { createReport, queueCounts, recentlyCompleted, visitMetrics } from "../core/queries.ts";
import { withCompanyContext } from "../core/memory.ts";
import { setAgentStatus, idleAgent, pushActivity } from "../core/status.ts";

export interface CeoCtx {
  store: Store;
  companyId: string;
  onReport: (content: string) => void;
}

function makeReadStateTool(companyId: string): ToolDef {
  return {
    name: "read_state",
    description: "Read the current queue counts and recently-completed tasks (what shipped).",
    parameters: Type.Object({}),
    async execute() {
      const counts = await queueCounts(companyId);
      const shipped = await recentlyCompleted(companyId);
      const traffic = await visitMetrics(companyId);
      return {
        ok: true,
        summary: JSON.stringify({ counts, recentlyCompleted: shipped, traffic }, null, 2),
        data: { counts, shipped, traffic },
      };
    },
  };
}

function makeWriteReportTool(companyId: string, onReport: (content: string) => void): ToolDef {
  return {
    name: "write_report",
    description: "Save the daily CEO report (one call).",
    parameters: Type.Object({ day_summary: Type.String() }),
    async execute(raw) {
      const { day_summary } = raw as { day_summary: string };
      const id = await createReport(companyId, "ceo_daily_summary", "Daily Summary", day_summary);
      onReport(day_summary);
      return { ok: true, summary: `Saved CEO report #${id}.` };
    },
  };
}

const prompt = `You are the CEO of this company. Your daily cycle: monitor the business, report to the
owner, maintain the task queue. Ground EVERYTHING in the company context above — mission, product, the
GOAL, and the brand voice.

THINK OUT LOUD — explain your reasoning as you work.

WORKFLOW (complete in order):

1. MONITOR — Read current state.
   Call read_state to see queue counts and "what shipped today" (recently-completed tasks). If this is
   the first day or nothing has shipped yet, that's normal — note the baseline. (We don't have analytics
   or infra logs yet; skip what you can't read — partial information is fine, never loop on a check.)

2. REVIEW — Evaluate today's work.
   "What shipped today" = ONLY the tasks read_state reports as recently completed. If that's empty, say
   "Today was a planning/monitoring day" — do NOT claim past or historical work as shipped today.

3. QUEUE MANAGEMENT — Maintain the backlog (this is critical).
   Count pending (suggested + todo + in_progress).
   - If EMPTY (0): create 3 task proposals now — a safety net.
   - If LOW (< 3): create 1–2.
   Every proposal must be a concrete step a founder would take to reach the GOAL this week — building
   the actual product (the landing page, the signup/subscribe flow, the core feature), getting it in
   front of customers, or the research that directly informs those. This is a real business racing to
   its goal, not a software project to maintain — propose what moves the needle on the goal, nothing
   self-referential about the codebase or tooling. Use create_task_proposal with a clear title,
   a description (what to do AND why — the execution agent only sees the description), tag "engineering"
   (code/app/deploy) or "research" (web search only), and priority (0 low … 3 critical). Stop at 3.

4. REPORT — Send the daily update.
   Call write_report exactly once. Conversational PROSE, not a structured report. Under 200 words.
   Structure: what shipped (1–2 inline "✓ {task} — {outcome}" items, ONLY from this cycle) · current
   status (1 sentence) · end with "Tomorrow: {specific next step}." No section headers, no bullet lists
   longer than 3, no tables. Bold for emphasis. Match the owner's language and tone (see user_context).

RULES:
- ALWAYS keep the queue ≥ 3 (create if needed). If empty, create the 3 BEFORE reporting.
- NEVER say "cycle" — say "today". You only PLAN; you never run tasks (the cron runs the top one).
- Never claim historical/memory items as "shipped today" — only this cycle's completed tasks.
- User silence = proceed with your plan. Never say "waiting for you" — you decide what's next.
- NEVER loop on a failing tool call — one retry max, then note the gap and move on.`;

export const ceo: AgentDef<CeoCtx> = {
  role: "ceo",
  prompt,
  makeTools({ store, companyId, onReport }) {
    return [
      makeReadStateTool(companyId),
      makeProposeTaskTool(store, companyId),
      makeWriteReportTool(companyId, onReport),
    ];
  },
};

export interface CeoCycleResult {
  report?: string;
}

/**
 * Run one CEO cycle — the CEO ONLY PLANS: maintains the `suggested` backlog (≥3) and writes the
 * daily report. It does NOT promote or run anything (that's the cron dispatcher's job — see
 * dispatchNext). This keeps proposals as a bounded backlog, not an exploding todo queue.
 */
export async function runCeoCycle(
  store: Store,
  runtime: AgentRuntime,
  companyId: string,
): Promise<CeoCycleResult> {
  let report: string | undefined;
  const toolCtx: ToolContext = { taskId: `ceo:${companyId}`, log: (type, payload) => pushActivity("ceo", type, payload) };

  const tools = ceo.makeTools({ store, companyId, onReport: (c) => (report = c) });

  // Put the company identity + GOAL in the USER turn — models weight the instruction far more than
  // prepended context, and this is what keeps proposals on-goal instead of generic project planning.
  const [co] = await db()<{ name: string; profile: { goal?: string; stage?: string } }[]>`
    SELECT name, profile FROM companies WHERE id = ${companyId}`;
  const goal = co?.profile?.goal ?? "reach the company's goal";
  const userPrompt =
    `Run today's cycle for ${co?.name ?? "the company"} (${co?.profile?.stage ?? "early stage"}). ` +
    `The GOAL is: ${goal}. First restate that goal in one line, then do the workflow. ` +
    `Every task you propose must directly advance THAT goal — concrete product, launch, or customer steps.`;

  setAgentStatus({ name: "ceo", mood: "thinking", message: "Reviewing the day and planning what's next…", taskId: null });
  let buf = "";
  for await (const ev of runtime.run({
    system: await withCompanyContext(companyId, ceo.prompt),
    prompt: userPrompt,
    tools,
    toolCtx,
  })) {
    if (ev.type === "text") { process.stdout.write(ev.text); buf += ev.text; setAgentStatus({ message: buf.slice(-800) }); }
  }
  idleAgent(report ? "Posted the daily update." : "");
  return { report };
}
