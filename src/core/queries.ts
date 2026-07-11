// Read/write helpers over the DB for the CEO/Planner + dashboard.
import { randomBytes } from "node:crypto";
import { db } from "./db.ts";

export interface QueueCounts {
  suggested: number;
  todo: number;
  in_progress: number;
  completedToday: number;
}

export async function queueCounts(companyId: string): Promise<QueueCounts> {
  const sql = db();
  const [r] = await sql<{ suggested: number; todo: number; in_progress: number; completed_today: number }[]>`
    SELECT
      count(*) FILTER (WHERE status='suggested')   ::int AS suggested,
      count(*) FILTER (WHERE status='todo')        ::int AS todo,
      count(*) FILTER (WHERE status='in_progress') ::int AS in_progress,
      count(*) FILTER (WHERE status='completed' AND ended_at > now() - interval '24 hours') ::int AS completed_today
    FROM tasks WHERE company_id = ${companyId}`;
  return { suggested: r.suggested, todo: r.todo, in_progress: r.in_progress, completedToday: r.completed_today };
}

/** "What Each Agent Did Today" — completed tasks in the cycle window. */
export async function recentlyCompleted(companyId: string, sinceHours = 24) {
  const sql = db();
  return sql<{ id: string; tag: string; title: string; summary: string | null }[]>`
    SELECT id, tag, title, result->>'summary' AS summary
    FROM tasks
    WHERE company_id = ${companyId} AND status='completed' AND ended_at > now() - (${sinceHours} || ' hours')::interval
    ORDER BY ended_at DESC`;
}

export async function editTask(
  taskId: string,
  f: { title?: string; description?: string; priority?: number },
): Promise<void> {
  const sql = db();
  if (f.title !== undefined) await sql`UPDATE tasks SET title=${f.title} WHERE id=${taskId}`;
  if (f.description !== undefined) await sql`UPDATE tasks SET description=${f.description} WHERE id=${taskId}`;
  if (f.priority !== undefined) await sql`UPDATE tasks SET priority=${f.priority} WHERE id=${taskId}`;
}

export async function createReport(
  companyId: string,
  type: string,
  name: string,
  content: string,
  taskId?: string,
): Promise<number> {
  const sql = db();
  const [r] = await sql<{ id: number }[]>`
    INSERT INTO reports (company_id, task_id, type, name, content)
    VALUES (${companyId}, ${taskId ?? null}, ${type}, ${name}, ${content})
    RETURNING id`;
  return r.id;
}

/** Recent activity across all of a company's tasks — for the dashboard feed. */
export async function recentEvents(companyId: string, limit = 40) {
  const sql = db();
  return sql<{ ts: Date; type: string; actor: string; payload: unknown; task_id: string }[]>`
    SELECT e.ts, e.type, e.actor, e.payload, e.task_id
    FROM task_events e JOIN tasks t ON t.id = e.task_id
    WHERE t.company_id = ${companyId}
    ORDER BY e.id DESC LIMIT ${limit}`;
}

// Phase 2 — first-party analytics. The beacon (in every built app) pings the control plane; we map
// its slug → company and record the hit. Metrics feed the Business snapshot + the CEO daily report.
export async function companyIdForSlug(slug: string): Promise<string | null> {
  const [r] = await db()<{ id: string }[]>`SELECT id FROM companies WHERE slug = ${slug}`;
  return r?.id ?? null;
}

export async function recordVisit(
  companyId: string,
  v: { visitorId?: string; path?: string; referer?: string; ua?: string },
): Promise<void> {
  await db()`INSERT INTO visits (company_id, visitor_id, path, referer, ua)
    VALUES (${companyId}, ${v.visitorId ?? null}, ${v.path ?? null}, ${v.referer ?? null}, ${v.ua ?? null})`;
}

export async function visitMetrics(companyId: string, sinceHours = 24) {
  const sql = db();
  const [r] = await sql<{ visits: number; uniques: number; total: number }[]>`
    SELECT
      count(*) FILTER (WHERE ts > now() - (${sinceHours} || ' hours')::interval)::int AS visits,
      count(DISTINCT visitor_id) FILTER (WHERE ts > now() - (${sinceHours} || ' hours')::interval)::int AS uniques,
      count(*)::int AS total
    FROM visits WHERE company_id = ${companyId}`;
  return { visitsToday: r?.visits ?? 0, uniquesToday: r?.uniques ?? 0, totalVisits: r?.total ?? 0 };
}

/** Onboarding: set the company's name + profile (ensureCompany is create-only / DO NOTHING). */
export async function updateCompanyProfile(
  companyId: string,
  name: string,
  profile: Record<string, unknown>,
): Promise<void> {
  const sql = db();
  // Derive a URL/deploy-safe slug from the name (used for the repo/Render service + beacon slug).
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "app";
  await sql`UPDATE companies SET name = ${name}, slug = ${slug}, profile = ${sql.json(profile as Parameters<typeof sql.json>[0])} WHERE id = ${companyId}`;
}

export async function markOnboarded(companyId: string): Promise<void> {
  await db()`UPDATE companies SET onboarded_at = now() WHERE id = ${companyId}`;
}

// Option A — persistent sandbox per company (the key the worker reconnects to).
export async function getSandboxId(companyId: string): Promise<string | null> {
  const [r] = await db()<{ sandbox_id: string | null }[]>`SELECT sandbox_id FROM companies WHERE id = ${companyId}`;
  return r?.sandbox_id ?? null;
}
export async function setSandboxId(companyId: string, sandboxId: string | null): Promise<void> {
  await db()`UPDATE companies SET sandbox_id = ${sandboxId} WHERE id = ${companyId}`;
}

// Secret-proxy — per-company bearer token deployed apps use to call /api/proxy/* (get-or-mint).
export async function ensureProxyToken(companyId: string): Promise<string> {
  const [r] = await db()<{ proxy_token: string | null }[]>`SELECT proxy_token FROM companies WHERE id = ${companyId}`;
  if (r?.proxy_token) return r.proxy_token;
  const token = "polsia_" + randomBytes(24).toString("base64url");
  await db()`UPDATE companies SET proxy_token = ${token} WHERE id = ${companyId}`;
  return token;
}
export async function companyIdForProxyToken(token: string): Promise<string | null> {
  if (!token) return null;
  const [r] = await db()<{ id: string }[]>`SELECT id FROM companies WHERE proxy_token = ${token}`;
  return r?.id ?? null;
}

export async function isOnboarded(companyId: string): Promise<boolean> {
  const [r] = await db()<{ onboarded_at: Date | null }[]>`SELECT onboarded_at FROM companies WHERE id = ${companyId}`;
  return !!r?.onboarded_at;
}

/** "Start a new company" — wipe all of a company's work so onboarding can rebuild it fresh. */
export async function resetCompany(companyId: string): Promise<void> {
  const sql = db();
  await sql`DELETE FROM task_events WHERE task_id IN (SELECT id FROM tasks WHERE company_id = ${companyId})`;
  await sql`DELETE FROM reports WHERE company_id = ${companyId}`;
  await sql`DELETE FROM executions WHERE company_id = ${companyId}`;
  await sql`DELETE FROM tasks WHERE company_id = ${companyId}`;
  await sql`DELETE FROM documents WHERE company_id = ${companyId}`;
  await sql`DELETE FROM context_graph WHERE company_id = ${companyId}`;
  await sql`DELETE FROM chat_messages WHERE company_id = ${companyId}`;
  await sql`UPDATE companies SET profile = '{}'::jsonb, onboarded_at = NULL, sandbox_id = NULL WHERE id = ${companyId}`;
}

/** Persist a chat message so the conversation survives page refreshes (Spec: chat agent 38). */
export async function saveMessage(companyId: string, role: "user" | "assistant", content: string): Promise<void> {
  await db()`INSERT INTO chat_messages (company_id, role, content) VALUES (${companyId}, ${role}, ${content})`;
}

export async function listMessages(companyId: string, limit = 100) {
  const rows = await db()<{ role: string; content: string }[]>`
    SELECT role, content FROM chat_messages WHERE company_id = ${companyId}
    ORDER BY id DESC LIMIT ${limit}`;
  return rows.reverse();
}

// J.7 Path B — DB-owned chat memory (rolling summary + recent turns; pi runs stateless).
export async function getChatState(companyId: string): Promise<{ summary: string; throughId: number }> {
  const [r] = await db()<{ summary: string; summarized_through_id: string }[]>`
    SELECT summary, summarized_through_id FROM chat_state WHERE company_id = ${companyId}`;
  return { summary: r?.summary ?? "", throughId: Number(r?.summarized_through_id ?? 0) };
}

export async function setChatSummary(companyId: string, summary: string, throughId: number): Promise<void> {
  await db()`
    INSERT INTO chat_state (company_id, summary, summarized_through_id)
    VALUES (${companyId}, ${summary}, ${throughId})
    ON CONFLICT (company_id) DO UPDATE SET summary = EXCLUDED.summary,
      summarized_through_id = EXCLUDED.summarized_through_id, updated_at = now()`;
}

/** The un-summarized recent tail (messages newer than the last folded id), with their ids. */
export async function messagesSince(companyId: string, sinceId: number) {
  return db()<{ id: string; role: string; content: string }[]>`
    SELECT id, role, content FROM chat_messages
    WHERE company_id = ${companyId} AND id > ${sinceId} ORDER BY id`;
}

export async function getReport(companyId: string, id: number) {
  const [r] = await db()<{ name: string; content: string }[]>`
    SELECT name, content FROM reports WHERE company_id = ${companyId} AND id = ${id}`;
  return r ?? null;
}

export async function recentReports(companyId: string, limit = 5) {
  const sql = db();
  return sql<{ id: number; type: string; name: string; content: string; created_at: Date }[]>`
    SELECT id, type, name, content, created_at FROM reports
    WHERE company_id = ${companyId} ORDER BY created_at DESC LIMIT ${limit}`;
}

/**
 * Ad-hoc execution selector (the continuous worker): the next runnable task among
 * `needs_continuation` (resume in-flight first) and `todo` (chat-created /
 * approved). Does NOT touch `suggested` — those are the daily cron's to promote. Top priority, oldest first.
 */
export async function nextAdHoc(companyId: string): Promise<string | null> {
  const [p] = await db()<{ id: string }[]>`
    SELECT id FROM tasks
    WHERE company_id = ${companyId} AND status IN ('needs_continuation','todo')
    ORDER BY (status='needs_continuation') DESC, priority DESC, created_at ASC
    LIMIT 1`;
  return p?.id ?? null;
}

/**
 * Daily-cron proposal selector: take the top-priority `suggested` proposal, PROMOTE it → `todo`,
 * and return its id (so the cron runs it to completion). Returns null if there are no proposals.
 */
export async function nextProposal(companyId: string): Promise<string | null> {
  const sql = db();
  const [p] = await sql<{ id: string }[]>`
    SELECT id FROM tasks WHERE company_id = ${companyId} AND status='suggested'
    ORDER BY priority DESC, created_at ASC LIMIT 1`;
  if (!p) return null;
  await sql`UPDATE tasks SET status='todo' WHERE id = ${p.id}`;
  return p.id;
}

/**
 * Crash recovery: a task left `in_progress` means its run died mid-flight (process restart/crash) —
 * nothing would ever pick it up again (nextAdHoc only sees needs_continuation/todo). Flip orphans to
 * `needs_continuation` so the workspace-preserving resume finishes them. Call on startup.
 */
export async function requeueOrphaned(companyId: string): Promise<number> {
  const rows = await db()<{ id: string }[]>`
    UPDATE tasks SET status='needs_continuation',
      resume_note = COALESCE(resume_note,
        'Your previous run was interrupted mid-build by a restart. The workspace already has your prior work — run ls, read what exists, then continue and finish the task.')
    WHERE company_id = ${companyId} AND status='in_progress' RETURNING id`;
  return rows.length;
}

/** Manually promote a suggested task → todo (run it via the worker without waiting for the cron). */
export async function approveTask(taskId: string): Promise<void> {
  await db()`UPDATE tasks SET status='todo' WHERE id = ${taskId} AND status='suggested'`;
}
export async function rejectTask(taskId: string): Promise<void> {
  await db()`UPDATE tasks SET status='rejected' WHERE id = ${taskId} AND status='suggested'`;
}
