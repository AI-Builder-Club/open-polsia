// The agent registry — the roster, one file per agent. `ls src/agents/` = who works here.
// Each def is { role, prompt, makeTools(ctx) }; drivers (worker, dashboard chat route, cron,
// onboarding flow) supply the per-run context. Adding an agent = adding a file + a line here.
export { engineering, type EngineeringCtx } from "./engineering.ts";
export { research, type ResearchCtx } from "./research.ts";
export { chat, type ChatCtx } from "./chat.ts";
export { ceo, runCeoCycle, type CeoCtx, type CeoCycleResult } from "./ceo.ts";
export { onboarding, runOnboarding, type OnboardingCtx } from "./onboarding.ts";
export type { AgentDef } from "./types.ts";

import { engineering } from "./engineering.ts";
import { research } from "./research.ts";
import { chat } from "./chat.ts";
import { ceo } from "./ceo.ts";
import { onboarding } from "./onboarding.ts";

export const agents = { engineering, research, chat, ceo, onboarding };
