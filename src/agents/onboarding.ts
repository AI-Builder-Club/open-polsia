// Onboarding agent — an in-app, single-tenant onboarding flow (no email / magic-link / drip).
// The def is the agent; runOnboarding is
// its one-shot driver: from an IDEA — research → name → profile + GOAL → documents → welcome →
// finish. Then the caller triggers the Day-1 cron.
import type { AgentRuntime } from "../runtime/types.ts";
import type { ToolContext } from "../tools/registry.ts";
import type { AgentDef } from "./types.ts";
import { makeOnboardingTools } from "../tools/onboarding.ts";
import { makeWebSearchTool } from "../tools/web-search.ts";
import { makeWebFetchTool } from "../tools/web-fetch.ts";
import { setAgentStatus, idleAgent, pushActivity } from "../core/status.ts";

export interface OnboardingCtx {
  companyId: string;
  onFinished: () => void;
}

const prompt = `You are Polsia, onboarding a new company. Do ALL the prep work upfront from the
founder's idea, then hand off — the autonomous daily build takes over after you finish.

Tools: set_mood · web_search · web_fetch · set_company_profile · write_document · set_context · send_reply · finish_onboarding.

Workflow (one shot — make the decisions yourself, do NOT ask questions):
1. set_mood('researching'). Briefly research the space with web_search (1–2 queries; web_fetch a page only if useful). Skip if the idea is obvious.
2. Name the company — original and functional (e.g. "PagePilot", "InboxZero"), NOT "[X] 2.0" or "[X]Clone". Web apps only; never promise a mobile app or building from an existing repo.
3. set_mood('building'), then set_company_profile: name, industry, a one-line pitch, stage ("pre-launch MVP" for a new idea), and a concrete GOAL that a founder would chase first (usually: ship a landing page that converts to paid signups).
4. write_document for each of: mission, product_overview, brand_voice. Make them specific and real to THIS company — not generic. Brand voice should describe how the company talks.
5. set_context with the founder's communication style if you can infer it; otherwise a sensible default.
6. send_reply: a short, warm welcome (≤80 words) to the owner — what you named it, the goal, and that you'll start building now. Use FUTURE tense for the build ("I'll build…"); never claim work is already done. Don't sign it.
7. set_mood('shipped'), then finish_onboarding.

Think out loud briefly as you go. Be decisive.`;

export const onboarding: AgentDef<OnboardingCtx> = {
  role: "onboarding",
  prompt,
  makeTools({ companyId, onFinished }) {
    return [
      makeWebSearchTool(),
      makeWebFetchTool(),
      ...makeOnboardingTools(companyId, onFinished),
    ];
  },
};

export async function runOnboarding(
  runtime: AgentRuntime,
  companyId: string,
  idea: string,
): Promise<void> {
  let finished = false;
  const tools = onboarding.makeTools({ companyId, onFinished: () => (finished = true) });
  const ctx: ToolContext = { taskId: `onboarding:${companyId}`, log: (type, payload) => pushActivity("onboarding", type, payload) };

  setAgentStatus({ name: "onboarding", mood: "thinking", message: "Setting up your company…", taskId: null });
  let buf = "";
  for await (const ev of runtime.run({
    system: onboarding.prompt,
    prompt: `The founder's idea: ${idea}\n\nOnboard this company now.`,
    tools,
    toolCtx: ctx,
  })) {
    if (ev.type === "text") { buf += ev.text; setAgentStatus({ message: buf.slice(-800) }); }
  }
  if (!finished) idleAgent("Onboarding ended without finishing — you can retry.");
}
