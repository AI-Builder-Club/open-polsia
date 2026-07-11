// Deploy orchestration (Phase 2): idea → live URL. Ties the platform pieces together:
//   1. ensure a per-company GitHub repo (deploy source)
//   2. provision a Neon Postgres (DATABASE_URL)
//   3. push the built workspace to the repo
//   4. create the Render web service with env injected (DATABASE_URL + beacon slug)
// Records the live URL + infra ids on the company so the dashboard's Website panel shows it.
import { db } from "../core/db.ts";
import { ensureProxyToken } from "../core/queries.ts";
import { ensureRepo, pushDir, pushViaSandbox } from "./github.ts";
import type { Sandbox } from "../sandbox/types.ts";
import { createNeonProject } from "./neon.ts";
import { createRenderService } from "./render.ts";

export interface DeployResult {
  url: string;
  repo: string;
  neonProjectId: string;
  renderServiceId: string;
}

/** Where the app's files live: a host directory (local Docker) or a remote sandbox (Daytona). */
export type DeploySource = { dir: string } | { sandbox: Sandbox };

/** Deploy a company's app to a live URL. Idempotent: the first call creates repo + Neon + Render;
 * later calls just push — Render autodeploys from the repo. Requires GITHUB_TOKEN (or gh CLI for
 * local dirs) + NEON_API_KEY + RENDER_API_KEY/OWNER_ID. */
export async function deployApp(
  companyId: string,
  slug: string,
  source: DeploySource,
): Promise<DeployResult> {
  const beaconUrl = process.env.POLSIA_BEACON_URL ?? "";
  const proxyToken = await ensureProxyToken(companyId); // secret-proxy: app calls /api/proxy/* with this
  const name = `polsia-${slug}`;

  const repo = await ensureRepo(name, `Polsia app for ${slug}`);
  const push = () =>
    "dir" in source ? pushDir(source.dir, repo, "polsia: deploy") : pushViaSandbox(source.sandbox, repo, "polsia: deploy");

  // REDEPLOY: infra already provisioned → just push; the Render service autodeploys from the repo.
  const [existing] = await db()<{ profile: { website?: string; repo?: string; neon_project_id?: string; render_service_id?: string } }[]>`
    SELECT profile FROM companies WHERE id = ${companyId}`;
  const prior = existing?.profile;
  if (prior?.render_service_id && prior.website && prior.neon_project_id) {
    await push();
    return { url: prior.website, repo: prior.repo ?? repo.url, neonProjectId: prior.neon_project_id, renderServiceId: prior.render_service_id };
  }

  const neon = await createNeonProject(name);
  await push();
  const svc = await createRenderService({
    name,
    repoUrl: repo.url,
    envVars: {
      DATABASE_URL: neon.connectionUri,
      POLSIA_ANALYTICS_SLUG: slug,
      POLSIA_BEACON_URL: beaconUrl,
      POLSIA_PROXY_URL: beaconUrl, // same host as the control plane
      POLSIA_PROXY_TOKEN: proxyToken,
      NODE_VERSION: "22",
    },
  });

  await db()`UPDATE companies SET profile = profile
    || ${db().json({ website: svc.url, repo: repo.url, neon_project_id: neon.projectId, render_service_id: svc.serviceId } as Parameters<ReturnType<typeof db>["json"]>[0])}
    WHERE id = ${companyId}`;
  return { url: svc.url, repo: repo.url, neonProjectId: neon.projectId, renderServiceId: svc.serviceId };
}
