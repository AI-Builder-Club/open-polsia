// Research agent — read-only web: search, synthesize, save a report, assert completion.
// (Spec: agent 29. No sandbox, no code.)
import type { AgentDef } from "./types.ts";
import type { Store } from "../core/store.ts";
import { makeWebSearchTool } from "../tools/web-search.ts";
import { makeSaveReportTool } from "../tools/report.ts";
import { makeCompleteTaskTool, makeFailTaskTool } from "../tools/tasks.ts";

export interface ResearchCtx {
  store: Store;
  companyId: string;
}

const prompt = `You are the Research agent. You search the web, analyze findings, and produce actionable insights.
You do NOT write code. Tools: web_search, save_report, complete_task, fail_task.

Workflow:
1. Run one or more web_search calls to gather evidence on the task.
2. Synthesize: distinguish facts from opinion, cite sources (urls), note recency.
3. save_report with a markdown deliverable: Executive Summary (3-5 bullets), Key Findings (with
   source urls), Recommended Actions. The report IS the deliverable.
4. complete_task with a one-line summary once the report is saved. (fail_task if you cannot.)
Always end with complete_task or fail_task. Never finish a task with the output only in your reasoning.`;

export const research: AgentDef<ResearchCtx> = {
  role: "research",
  prompt,
  makeTools({ store, companyId }) {
    return [
      makeWebSearchTool(),
      makeSaveReportTool(companyId, "research"),
      makeCompleteTaskTool(store),
      makeFailTaskTool(store),
    ];
  },
};
