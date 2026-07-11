// memoryLoader (Phase 1, narrowed): inject COMPANY context into an agent's system prompt.
// NOT conversation memory — pi's auto-compaction handles rolling-summary + recent-N within a
// session (use file-backed SessionManager for the chat agent). This is external-knowledge only:
// company profile + the documents + context-graph nodes.
import { db } from "./db.ts";

export async function upsertDocument(companyId: string, type: string, content: string): Promise<void> {
  await db()`
    INSERT INTO documents (company_id, type, content) VALUES (${companyId}, ${type}, ${content})
    ON CONFLICT (company_id, type) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`;
}

export async function upsertContextNode(
  companyId: string,
  nodeType: string,
  data: Record<string, unknown>,
): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO context_graph (company_id, node_type, data)
    VALUES (${companyId}, ${nodeType}, ${sql.json(data as Parameters<typeof sql.json>[0])})
    ON CONFLICT (company_id, node_type) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
}

export async function getDocument(companyId: string, type: string): Promise<string | null> {
  const [d] = await db()<{ content: string }[]>`
    SELECT content FROM documents WHERE company_id = ${companyId} AND type = ${type}`;
  return d?.content ?? null;
}

/** Assemble the company-context block to prepend to an agent's system prompt. */
export async function loadCompanyContext(companyId: string): Promise<string> {
  const sql = db();
  const [co] = await sql<{ name: string; profile: Record<string, unknown> }[]>`
    SELECT name, profile FROM companies WHERE id = ${companyId}`;
  const docs = await sql<{ type: string; content: string }[]>`
    SELECT type, content FROM documents WHERE company_id = ${companyId} AND content <> '' ORDER BY type`;
  const nodes = await sql<{ node_type: string; data: Record<string, unknown> }[]>`
    SELECT node_type, data FROM context_graph WHERE company_id = ${companyId} ORDER BY node_type`;

  if (!co) return "";
  const parts: string[] = ["# Company context", `Company: ${co.name}`];
  if (co.profile && Object.keys(co.profile).length) parts.push(`Profile: ${JSON.stringify(co.profile)}`);
  for (const n of nodes) parts.push(`[${n.node_type}] ${JSON.stringify(n.data)}`);
  for (const d of docs) parts.push(`## ${d.type}\n${d.content}`);
  return parts.join("\n\n");
}

/** Compose company context + an agent's role prompt into the full system prompt. */
export async function withCompanyContext(companyId: string, agentPrompt: string): Promise<string> {
  const ctx = await loadCompanyContext(companyId);
  return ctx ? `${ctx}\n\n---\n\n${agentPrompt}` : agentPrompt;
}
