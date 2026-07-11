// deploy_app — the engineering agent ships the current workspace to a live URL (Phase 2).
// Works from a host dir (local Docker) or a remote sandbox (Daytona); records the URL on the company.
import { Type } from "@sinclair/typebox";
import type { ToolDef } from "./registry.ts";
import { deployApp, type DeploySource } from "../platform/deploy.ts";

export function makeDeployTool(companyId: string, slug: string, source: DeploySource): ToolDef {
  return {
    name: "deploy_app",
    description:
      "Deploy the current app to a live public URL (creates/uses its GitHub repo + Postgres, pushes, and starts the service). Call when the task asks to deploy/launch/ship the app live. Returns the URL.",
    parameters: Type.Object({}),
    async execute(_args, ctx) {
      try {
        const r = await deployApp(companyId, slug, source);
        ctx.log("tool_result", { name: "deploy_app", url: r.url });
        return { ok: true, summary: `Deployed → ${r.url} (repo ${r.repo})`, data: r };
      } catch (err) {
        return { ok: false, summary: `Deploy failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}
