// Render — deploy a built app from its GitHub repo (Phase 2). Each app = one Render web service with
// a free *.onrender.com URL (no custom-domain cost). Needs RENDER_API_KEY + RENDER_OWNER_ID (workspace id).
const RENDER_API = "https://api.render.com/v1";

function key(): string {
  const k = process.env.RENDER_API_KEY;
  if (!k) throw new Error("RENDER_API_KEY not set");
  return k;
}

export interface RenderService {
  serviceId: string;
  url: string; // the *.onrender.com URL
}

export interface DeployOpts {
  name: string;
  repoUrl: string; // https://github.com/owner/name
  envVars: Record<string, string>; // DATABASE_URL, POLSIA_ANALYTICS_SLUG, POLSIA_BEACON_URL, PORT…
  branch?: string;
  rootDir?: string; // deploy from a subdirectory of the repo (default: repo root)
  buildCommand?: string; // default: npm install
  startCommand?: string; // default: node server.js
}

/** Create a Node web service from a GitHub repo. Returns the service id + live URL. */
export async function createRenderService(opts: DeployOpts): Promise<RenderService> {
  const ownerId = process.env.RENDER_OWNER_ID;
  if (!ownerId) throw new Error("RENDER_OWNER_ID not set");
  const body = {
    type: "web_service",
    name: opts.name,
    ownerId,
    repo: opts.repoUrl,
    branch: opts.branch ?? "main",
    autoDeploy: "yes",
    ...(opts.rootDir ? { rootDir: opts.rootDir } : {}),
    serviceDetails: {
      env: "node",
      envSpecificDetails: {
        buildCommand: opts.buildCommand ?? "npm install",
        startCommand: opts.startCommand ?? "node server.js",
      },
      plan: "starter",
    },
    envVars: Object.entries(opts.envVars).map(([k, v]) => ({ key: k, value: v })),
  };
  const res = await fetch(`${RENDER_API}/services`, {
    method: "POST",
    headers: { authorization: `Bearer ${key()}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`render create ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { service: { id: string; serviceDetails?: { url?: string } } };
  const id = data.service.id;
  const url = data.service.serviceDetails?.url ?? `https://${opts.name}.onrender.com`;
  return { serviceId: id, url };
}

export async function deleteRenderService(serviceId: string): Promise<void> {
  const res = await fetch(`${RENDER_API}/services/${serviceId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${key()}`, accept: "application/json" },
  });
  if (!res.ok && res.status !== 404) throw new Error(`render delete ${res.status}`);
}
