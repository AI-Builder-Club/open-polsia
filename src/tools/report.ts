// save_report tool — an agent saves its deliverable as a report (linked to the task). Spec: J.4.
import { Type } from "@sinclair/typebox";
import { createReport } from "../core/queries.ts";
import type { ToolDef } from "./registry.ts";

export function makeSaveReportTool(companyId: string, type: string): ToolDef {
  return {
    name: "save_report",
    description: "Save your full deliverable as a report (markdown). This is THE deliverable — do it before complete_task.",
    parameters: Type.Object({ name: Type.String(), content: Type.String() }),
    async execute(raw, ctx) {
      const args = raw as { name: string; content: string };
      const id = await createReport(companyId, type, args.name, args.content, ctx.taskId);
      return { ok: true, summary: `Saved report #${id} ("${args.name}").`, data: { reportId: id } };
    },
  };
}
