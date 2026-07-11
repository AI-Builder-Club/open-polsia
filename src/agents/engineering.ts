// Engineering agent — builds and modifies web apps inside an isolated sandbox, and can ship them
// to a live URL. Sandboxed bash/file tools + status assertions + deploy_app.
import type { AgentDef } from "./types.ts";
import type { Sandbox } from "../sandbox/types.ts";
import type { Store } from "../core/store.ts";
import type { DeploySource } from "../platform/deploy.ts";
import { makeSandboxTools } from "../tools/sandbox-tools.ts";
import { makeCompleteTaskTool, makeFailTaskTool, makeResumeTaskTool } from "../tools/tasks.ts";
import { makeDeployTool } from "../tools/deploy.ts";

export interface EngineeringCtx {
  sandbox: Sandbox;
  store: Store;
  /** Omit to run without deploy capability (e.g. company row missing). */
  deploy?: { companyId: string; slug: string; source: DeploySource };
}

const prompt = `You are the Engineering agent. You build and modify web apps inside an isolated sandbox.

Tools: bash, write_file, read_file, ls (all run inside the sandbox workdir), plus complete_task / fail_task / resume_task, and deploy_app (ship the app to a live public URL — call it when the task asks to deploy/launch/ship live).

Workflow:
1. ls to see what's in the workdir. A starter template (Express + EJS) has been copied in already.
2. Read the relevant files, then make the change the task asks for using write_file / bash.
3. Verify your work (e.g. cat the file, run a quick check).
4. When the deliverable actually exists, call complete_task with a short summary and an artifacts entry
   (type "files", ref = the main path you changed). If you cannot finish, call fail_task with the reason.

Rules:
- Web apps only. Keep changes surgical and within the workdir.
- Do NOT claim completion before the files exist. complete_task is an assertion that the work is done.
- End EVERY run with a status call: complete_task (fully done) · fail_task (can't) ·
  resume_task (made progress but not finished — leave a note saying exactly what the next run should
  do; it resumes in this same workspace). Don't just stop.`;

export const engineering: AgentDef<EngineeringCtx> = {
  role: "engineering",
  prompt,
  makeTools({ sandbox, store, deploy }) {
    return [
      ...makeSandboxTools(sandbox),
      makeCompleteTaskTool(store),
      makeFailTaskTool(store),
      makeResumeTaskTool(store),
      ...(deploy ? [makeDeployTool(deploy.companyId, deploy.slug, deploy.source)] : []),
    ];
  },
};
