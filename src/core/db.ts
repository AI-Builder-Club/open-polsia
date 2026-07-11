// Postgres connection + schema bootstrap. Plain SQL applied on boot (CREATE IF NOT
// EXISTS); typed access lives in pg-store.ts.
import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

const DEFAULT_URL = "postgres://postgres:polsia@localhost:5433/polsia";

let _sql: Sql | null = null;

export function db(): Sql {
  if (!_sql) _sql = postgres(process.env.DATABASE_URL ?? DEFAULT_URL, { onnotice: () => {} });
  return _sql;
}

export async function bootstrap(): Promise<void> {
  const sql = db();
  await sql`
    CREATE TABLE IF NOT EXISTS companies (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      slug        TEXT NOT NULL,
      profile     JSONB NOT NULL DEFAULT '{}'::jsonb,
      autonomy    TEXT NOT NULL DEFAULT 'supervised',  -- 'supervised' | 'full'
      onboarded_at TIMESTAMPTZ,                         -- set when the onboarding agent finishes
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ`;
  await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS sandbox_id TEXT`; // Option A: persistent sandbox per company (→ per project later)
  await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS proxy_token TEXT`; // secret-proxy: bearer token deployed apps use to call /api/proxy/*
  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id           TEXT PRIMARY KEY,
      company_id   TEXT NOT NULL REFERENCES companies(id),
      title        TEXT NOT NULL,
      description  TEXT NOT NULL,
      tag          TEXT NOT NULL,
      status       TEXT NOT NULL,           -- suggested|todo|in_progress|completed|failed|needs_continuation|blocked|rejected
      priority     SMALLINT NOT NULL DEFAULT 1,  -- 0 low · 1 medium · 2 high · 3 critical
      result       JSONB,
      resume_note  TEXT,                    -- J.5: handoff note for the next execution
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at   TIMESTAMPTZ,
      ended_at     TIMESTAMPTZ
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS task_events (
      id        BIGSERIAL PRIMARY KEY,
      task_id   TEXT NOT NULL REFERENCES tasks(id),
      ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
      type      TEXT NOT NULL,
      actor     TEXT NOT NULL,
      payload   JSONB NOT NULL DEFAULT '{}'::jsonb
    )`;
  await sql`CREATE INDEX IF NOT EXISTS task_events_task_idx ON task_events(task_id, id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS executions (
      id          BIGSERIAL PRIMARY KEY,
      task_id     TEXT NOT NULL REFERENCES tasks(id),
      company_id  TEXT NOT NULL REFERENCES companies(id),
      agent       TEXT NOT NULL,
      status      TEXT NOT NULL,
      summary     TEXT,
      started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      ended_at    TIMESTAMPTZ
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS reports (
      id          BIGSERIAL PRIMARY KEY,
      company_id  TEXT NOT NULL REFERENCES companies(id),
      task_id     TEXT REFERENCES tasks(id),
      type        TEXT NOT NULL,
      name        TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS documents (
      company_id  TEXT NOT NULL REFERENCES companies(id),
      type        TEXT NOT NULL,            -- mission|product_overview|tech_notes|brand_voice|user_research
      content     TEXT NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (company_id, type)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id          BIGSERIAL PRIMARY KEY,
      company_id  TEXT NOT NULL REFERENCES companies(id),
      role        TEXT NOT NULL,            -- 'user' | 'assistant'
      content     TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS chat_messages_company_idx ON chat_messages(company_id, id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS chat_state (
      company_id            TEXT PRIMARY KEY REFERENCES companies(id),
      summary               TEXT NOT NULL DEFAULT '',  -- rolling compaction of older turns (J.7 Path B)
      summarized_through_id BIGINT NOT NULL DEFAULT 0, -- last chat_messages.id folded into summary
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS visits (
      id          BIGSERIAL PRIMARY KEY,
      company_id  TEXT NOT NULL REFERENCES companies(id),
      visitor_id  TEXT,                    -- localStorage UUID from the beacon
      path        TEXT,
      referer     TEXT,
      ua          TEXT,
      ts          TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS visits_company_idx ON visits(company_id, ts)`;
  await sql`
    CREATE TABLE IF NOT EXISTS context_graph (
      company_id  TEXT NOT NULL REFERENCES companies(id),
      node_type   TEXT NOT NULL,
      data        JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (company_id, node_type)
    )`;
}

/** Ensure a single-tenant company row exists; returns its id. */
export async function ensureCompany(
  id: string,
  name: string,
  slug: string,
  profile: Record<string, unknown> = {},
): Promise<string> {
  const sql = db();
  // Create-if-absent; do NOT clobber a seeded company's name/profile on later calls.
  await sql`
    INSERT INTO companies (id, name, slug, profile)
    VALUES (${id}, ${name}, ${slug}, ${sql.json(profile as Parameters<typeof sql.json>[0])})
    ON CONFLICT (id) DO NOTHING`;
  return id;
}
