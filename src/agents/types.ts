// Agent definition — the registry's unit. One file per agent under src/agents/:
// the def says WHAT an agent is (role + prompt + complete tool surface); drivers (worker, dashboard
// chat route, cron, onboarding flow) say WHEN it runs and supply the per-run context.
// Per-def Ctx typing is the point: each agent's capability surface is explicit and auditable.
import type { ToolDef } from "../tools/registry.ts";

export interface AgentDef<Ctx> {
  role: string;
  prompt: string;
  makeTools(ctx: Ctx): ToolDef[];
  // later: model, skills (ROLE_SKILLS mapping)
}
