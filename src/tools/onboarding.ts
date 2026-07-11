// Onboarding agent toolset (no email/magic-link). Sets up a new
// company from an idea: profile + GOAL, the documents, the live face (set_mood), and a welcome
// posted to chat. No sandbox — docs/planning only; the real build is the Day-1 cron's job.
import { Type } from "@sinclair/typebox";
import type { ToolDef } from "./registry.ts";
import { updateCompanyProfile, markOnboarded, saveMessage } from "../core/queries.ts";
import { upsertDocument, upsertContextNode } from "../core/memory.ts";
import { setAgentStatus, type AgentMood } from "../core/status.ts";

const DOC_TYPES = ["mission", "product_overview", "brand_voice"] as const;
const MOODS: AgentMood[] = ["thinking", "building", "researching", "shipped"];

export function makeOnboardingTools(companyId: string, onFinish: () => void): ToolDef[] {
  return [
    {
      name: "set_mood",
      description: "Set your live dashboard face: thinking | researching | building | shipped. Call at the start and as your state changes.",
      parameters: Type.Object({ mood: Type.String({ description: MOODS.join(" | ") }) }),
      async execute(raw) {
        const m = (raw as { mood: string }).mood as AgentMood;
        setAgentStatus({ name: "onboarding", mood: MOODS.includes(m) ? m : "thinking" });
        return { ok: true, summary: `mood: ${m}` };
      },
    },
    {
      name: "set_company_profile",
      description: "Set the company's name + profile. profile must include: industry, one_liner, stage, and a concrete GOAL.",
      parameters: Type.Object({
        name: Type.String(),
        industry: Type.String(),
        one_liner: Type.String(),
        stage: Type.String({ description: "e.g. 'pre-launch MVP'" }),
        goal: Type.String({ description: "the concrete goal, e.g. 'ship a landing page that converts to paid signups'" }),
      }),
      async execute(raw) {
        const a = raw as { name: string; industry: string; one_liner: string; stage: string; goal: string };
        await updateCompanyProfile(companyId, a.name, { industry: a.industry, one_liner: a.one_liner, stage: a.stage, goal: a.goal });
        await upsertContextNode(companyId, "company_profile", { name: a.name, industry: a.industry, model: a.one_liner });
        setAgentStatus({ message: `Named the company "${a.name}" — ${a.one_liner}` });
        return { ok: true, summary: `Set profile for ${a.name}.` };
      },
    },
    {
      name: "write_document",
      description: `Write a company document. type: ${DOC_TYPES.join(" | ")}. Make it real and specific to this company.`,
      parameters: Type.Object({ type: Type.String(), content: Type.String() }),
      async execute(raw) {
        const a = raw as { type: string; content: string };
        await upsertDocument(companyId, a.type, a.content);
        setAgentStatus({ message: `Wrote the ${a.type.replace(/_/g, " ")} doc.` });
        return { ok: true, summary: `Wrote ${a.type}.` };
      },
    },
    {
      name: "set_context",
      description: "Save user_context (the founder's communication style / preferences) to the context graph.",
      parameters: Type.Object({ comm_style: Type.Optional(Type.String()), notes: Type.Optional(Type.String()) }),
      async execute(raw) {
        const a = raw as { comm_style?: string; notes?: string };
        await upsertContextNode(companyId, "user_context", { comm_style: a.comm_style ?? "", notes: a.notes ?? "" });
        return { ok: true, summary: "Saved user_context." };
      },
    },
    {
      name: "send_reply",
      description: "Post a short, warm welcome to the owner's chat — what you set up + that the daily build starts now. Future tense for the build.",
      parameters: Type.Object({ message: Type.String() }),
      async execute(raw) {
        await saveMessage(companyId, "assistant", (raw as { message: string }).message);
        return { ok: true, summary: "Posted welcome to chat." };
      },
    },
    {
      name: "finish_onboarding",
      description: "Call once everything is set up (profile + documents + welcome). Marks onboarding complete.",
      parameters: Type.Object({}),
      async execute() {
        await markOnboarded(companyId);
        setAgentStatus({ name: "onboarding", mood: "shipped", message: "Company is set up — starting the daily build." });
        onFinish();
        return { ok: true, summary: "Onboarding complete." };
      },
    },
  ];
}
