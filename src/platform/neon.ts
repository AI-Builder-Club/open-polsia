// Neon — provision a Postgres database per built app (Phase 2). Each company's deployed app gets its
// own isolated Neon project; we inject the connection URI as DATABASE_URL at deploy time.
const NEON_API = "https://console.neon.tech/api/v2";

function key(): string {
  const k = process.env.NEON_API_KEY;
  if (!k) throw new Error("NEON_API_KEY not set");
  return k;
}

export interface NeonProject {
  projectId: string;
  connectionUri: string; // → DATABASE_URL for the app
}

export async function createNeonProject(name: string): Promise<NeonProject> {
  const res = await fetch(`${NEON_API}/projects`, {
    method: "POST",
    headers: { authorization: `Bearer ${key()}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ project: { name } }),
  });
  if (!res.ok) throw new Error(`neon create ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { project: { id: string }; connection_uris: { connection_uri: string }[] };
  return { projectId: data.project.id, connectionUri: data.connection_uris[0]?.connection_uri ?? "" };
}

export async function deleteNeonProject(projectId: string): Promise<void> {
  const res = await fetch(`${NEON_API}/projects/${projectId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${key()}`, accept: "application/json" },
  });
  if (!res.ok && res.status !== 404) throw new Error(`neon delete ${res.status}`);
}
