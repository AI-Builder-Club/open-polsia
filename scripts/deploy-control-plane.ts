// Deploy the CONTROL PLANE (dashboard/API) itself to Render — one-off.
// Provisions a Neon Postgres for platform state, then creates a Render web service from this repo.
// After this, POLSIA_BEACON_URL resolves publicly and built apps' beacons land in the cloud
// control plane.
//
// Usage: CONTROL_PLANE_REPO_URL=https://github.com/<you>/open-polsia pnpm tsx scripts/deploy-control-plane.ts
// Needs in .env: NEON_API_KEY, RENDER_API_KEY, RENDER_OWNER_ID, ANTHROPIC_API_KEY,
//                TAVILY_API_KEY, DAYTONA_API_KEY
import { randomBytes } from "node:crypto";
import { createNeonProject } from "../src/platform/neon.ts";
import { createRenderService } from "../src/platform/render.ts";

const NAME = "open-polsia-control";
// The GitHub repo Render deploys from — your fork/clone of this project.
const REPO_URL = process.env.CONTROL_PLANE_REPO_URL ?? "https://github.com/your-org/open-polsia";

function required(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`${k} not set`);
  return v;
}

const password = process.env.POLSIA_DASHBOARD_PASSWORD ?? randomBytes(12).toString("base64url");
const guessedUrl = `https://${NAME}.onrender.com`;

console.log(`→ provisioning Neon project '${NAME}'…`);
const neon = await createNeonProject(NAME);
console.log(`  neon project ${neon.projectId}`);

console.log(`→ creating Render service '${NAME}' from ${REPO_URL}…`);
const svc = await createRenderService({
  name: NAME,
  repoUrl: REPO_URL,
  rootDir: ".",
  buildCommand: "corepack enable && pnpm install --prod=false",
  startCommand: "pnpm dashboard",
  envVars: {
    DATABASE_URL: neon.connectionUri,
    ANTHROPIC_API_KEY: required("ANTHROPIC_API_KEY"),
    TAVILY_API_KEY: required("TAVILY_API_KEY"),
    DAYTONA_API_KEY: required("DAYTONA_API_KEY"),
    NEON_API_KEY: required("NEON_API_KEY"),
    RENDER_API_KEY: required("RENDER_API_KEY"),
    RENDER_OWNER_ID: required("RENDER_OWNER_ID"),
    SANDBOX_PROVIDER: "daytona",
    ...(process.env.GITHUB_TOKEN ? { GITHUB_TOKEN: process.env.GITHUB_TOKEN } : {}), // cloud deploys push via token

    POLSIA_BEACON_URL: guessedUrl,
    POLSIA_DASHBOARD_PASSWORD: password,
    NODE_VERSION: "22",
  },
});

console.log(`\n✅ control plane deploying`);
console.log(`   url:      ${svc.url}`);
console.log(`   service:  ${svc.serviceId}`);
console.log(`   neon:     ${neon.projectId}`);
console.log(`   login:    polsia / ${password}`);
if (svc.url !== guessedUrl)
  console.log(`   ⚠ actual URL differs from POLSIA_BEACON_URL (${guessedUrl}) — update the env var in Render.`);
