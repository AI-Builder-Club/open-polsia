# open-polsia — Architecture

open-polsia is an open-source autonomous AI business-agent platform. You give it a
company idea; a fleet of specialized agents — an onboarding agent, a CEO/planner, an
engineering agent, a research agent, and a chat cofounder — autonomously plan, build,
and deploy real web apps for that company on a daily loop.

This document explains how the system fits together: the daily autonomy loop, the
runtime and sandbox seams, the Postgres data model, the memory/context model, and the
deploy pipeline that turns an idea into a live public URL.

---

## 1. The big picture

```
                       ┌──────────────────────────────────────────────────────────┐
                       │                    CONTROL PLANE                          │
                       │              (single Node process, Postgres)              │
                       │                                                           │
  founder's idea ──▶  │  ┌────────────┐   ┌──────────────┐   ┌──────────────────┐ │
                       │  │ Onboarding │   │  Dashboard   │   │   Daily Cron     │ │
                       │  │   agent    │   │ HTTP server  │   │ (autonomous beat)│ │
                       │  └─────┬──────┘   │  + chat API  │   └────────┬─────────┘ │
                       │        │          └──────┬───────┘            │           │
   owner chat  ◀────▶  │        │                 │ chat agent         │           │
                       │        │                 │ (orchestrator)     ▼           │
                       │        ▼                 ▼            ┌──────────────────┐ │
                       │  ┌───────────────────────────────┐   │  CEO / Planner   │ │
                       │  │        Postgres schema        │◀──│  (proposes tasks │ │
                       │  │ companies · tasks · events ·  │   │   + daily report)│ │
                       │  │ executions · reports · docs · │   └────────┬─────────┘ │
                       │  │ chat · visits · context_graph │            │           │
                       │  └───────────────┬───────────────┘            │           │
                       │                  │                            ▼           │
                       │                  │                   ┌──────────────────┐ │
                       │                  └──────────────────▶│      Worker      │ │
                       │                                      │ (runs one task,  │ │
                       │            ┌─────────────────────────┤  tagged agent)   │ │
                       │            │  AgentRuntime (pi)       └────────┬─────────┘ │
                       │            │  system+prompt+tools →           │           │
                       │            │  event stream                    ▼           │
                       │            │                          ┌──────────────────┐│
                       │            └─────────────────────────▶│     Sandbox      ││
                       │                                       │ LocalDocker /    ││
                       │                                       │ Daytona (cloud)  ││
                       │                                       └────────┬─────────┘│
                       └────────────────────────────────────────────────┼─────────┘
                                                                         │ deploy_app
                                                                         ▼
                    ┌────────────────────────────────────────────────────────────┐
                    │                      APP PLANE (per company)                │
                    │  GitHub repo  ──▶  Render web service  ──▶  live *.onrender  │
                    │        │                    │                     │ URL      │
                    │        │              Neon Postgres          analytics       │
                    │        │              (DATABASE_URL)          beacon ────────┼──▶ back to
                    │        └───────────── secret proxy (LLM keys) ───────────────┼──▶ control plane
                    └────────────────────────────────────────────────────────────┘
```

The **control plane** is a single Node process backed by Postgres. It hosts the
dashboard, the agent fleet, the task queue, and the deploy pipeline. The **app plane**
is everything the engineering agent ships: one GitHub repo, one Render web service, and
one Neon Postgres database per company, all wired back to the control plane for
analytics and LLM access.

---

## 2. The daily autonomy loop

The heart of the platform is a single autonomous beat, driven by `runDailyCron`
(`src/core/cron.ts`). Each cycle:

1. **Promote and run one task.** `nextProposal` takes the highest-priority `suggested`
   proposal, promotes it to `todo`, and returns its id. The worker then runs it to
   *full* completion (`runToCompletion`) — resuming in place, run after run, until it
   reaches a terminal state or hits the resume cap.
2. **CEO review — only on real completion.** If (and only if) the task actually
   completed — or there was nothing to run — the CEO/planner cycle fires
   (`runCeoCycle`). It reads current state, tops the backlog back up to at least three
   proposals, and writes the daily report. If the task is still mid-flight, review is
   skipped so the CEO never narrates half-finished work.

The CEO **only plans** — it maintains the `suggested` backlog and writes reports; it
never promotes or runs anything itself. That separation keeps the proposal queue a
bounded backlog rather than an exploding `todo` list.

### The autonomy gate

Autonomous proposals never execute silently. The gate is the `suggested` → `todo`
promotion step:

- The CEO's `create_task_proposal` tool writes tasks with status **`suggested`**.
- Only `nextProposal` (the daily cron), an explicit **approve** action from the
  dashboard/chat (`approveTask`), or a task run-link click promotes `suggested` →
  `todo`.
- The continuous ad-hoc worker (`nextAdHoc`) deliberately **never touches `suggested`
  tasks** — those belong to the cron. It only picks up `todo` (chat-created or approved)
  and `needs_continuation` (resume-in-flight) work.

This gives two dispatch paths over one queue: the **daily cron** owns the autonomous
backlog; the **continuous worker** owns human-initiated and in-flight work.

### Agent-asserted completion

The worker (`src/core/worker.ts`) enforces a strict **status-integrity guard**: it
never auto-completes a task. Execution agents must assert their own terminal state via a
tool call:

- `complete_task` — the deliverable exists; mark completed (with artifacts).
- `fail_task` — cannot produce the deliverable; mark failed with a reason.
- `resume_task` — made progress but not finished; checkpoint to
  **`needs_continuation`** and leave a handoff note for the next run.

If a run ends while the task is still `in_progress` (the agent just stopped without
asserting anything), the worker forces it to `needs_continuation` — *not* completed.
`runToCompletion` then resumes it immediately, in the same sitting, up to `maxRuns` (5)
times. On resume, the prior run's handoff note is injected into the prompt and the
sandbox workspace is preserved, so the agent continues rather than restarting.

Crash recovery closes the loop: on startup, `requeueOrphaned` flips any task stuck in
`in_progress` (its process died mid-run) to `needs_continuation`, with a note explaining
the workspace already holds prior work.

---

## 3. The AgentRuntime swap seam

Every agent run goes through the `AgentRuntime` interface (`src/runtime/types.ts`):

```ts
interface AgentRuntime {
  run(opts: RunOpts): AsyncIterable<AgentEvent>;
}
// RunOpts = { system, prompt, tools, toolCtx, model?, signal? }
```

It is intentionally pure: given a system prompt, a user prompt, and a scoped tool set,
it yields a neutral `AgentEvent` stream (`text`, `tool_call`, `tool_result`, `final`,
`error`). The runtime knows nothing about sandboxes, companies, or the queue — isolation
is an implementation detail of the *tools* it is handed.

The current implementation, `PiRuntime` (`src/runtime/pi.ts`), wraps the `pi`
coding-agent SDK. Two design choices matter:

- **No host leakage.** The session runs in a neutral temp cwd with `noExtensions`,
  `noSkills`, `noContextFiles`, etc., and the tool allowlist contains *only* our custom
  tools by name. pi's built-in bash/read/edit/write are excluded entirely, so an agent's
  only capabilities are the ones we explicitly grant.
- **Stateless.** The runtime uses an in-memory session manager. Conversation memory,
  where needed, is owned by *us* in Postgres (see §5), not by the runtime.

Because the seam is this thin, swapping in a different agent backend later is a matter of
implementing one interface — no agent, tool, or worker code changes.

---

## 4. The Sandbox abstraction

Every shell command, file write, and file read the engineering agent issues runs inside
an isolated **Sandbox** (`src/sandbox/types.ts`), never on the control-plane host. The
sandbox tools (`bash`, `write_file`, `read_file`, `ls`) route through `Sandbox.exec`, so
swapping the sandbox provider requires no tool changes.

Two implementations satisfy the same interface, chosen by `createSandbox`
(`src/sandbox/factory.ts`) via `SANDBOX_PROVIDER`:

| | **LocalDockerSandbox** (default, dev) | **DaytonaSandbox** (`SANDBOX_PROVIDER=daytona`, prod) |
|---|---|---|
| Isolation | One long-lived `node:22-alpine` container, `docker exec` | Managed cloud sandbox (`node:22` image) |
| Workdir | Host bind-mount (`workspaces/<taskId>/`) | `<root>/app` inside the sandbox |
| Persistence | The host dir *is* the persistence | `stop` + `archive` on release (FS incl. `node_modules` preserved) |
| Reconnect id | none (`id()` → null) | sandbox id, stored on the company row |
| Preview URL | none | `getPreviewLink(port)` |

**Per-company persistence (warm workspaces).** The worker stores a Daytona sandbox id on
the company (`companies.sandbox_id`) and reconnects to it on the next task, so
dependencies and prior work stay warm. Local Docker achieves the same via the stable
host directory. On the first run the worker seeds the starter template; on resume it
detects a non-empty workspace (`isEmpty()`) and skips re-seeding.

The sandbox lifecycle is `create → seed (first run only) → exec… → release (preserve
state)`. `dispose()` is the hard teardown used only for reset/abandon.

---

## 5. Memory and context model

open-polsia keeps two kinds of memory strictly separate.

### Company context (external knowledge)

`withCompanyContext` (`src/core/memory.ts`) prepends a **Company context** block to an
agent's system prompt on every run. It assembles:

- the company row's `name` + `profile` (industry, one-liner, stage, and the **GOAL**),
- the company **documents** (`mission`, `product_overview`, `tech_notes`, `brand_voice`,
  `user_research`) that have content,
- the **context-graph** nodes (e.g. `company_profile`, `user_context`).

This grounds every agent in the same shared identity and goal. The CEO cycle goes
further and restates the GOAL in the *user* turn as well, because models weight the
active instruction more heavily than prepended context — this is what keeps proposals
on-goal instead of drifting into generic project maintenance.

### Conversation memory (compaction)

The chat cofounder's conversation is owned in Postgres, not in the runtime
(`src/core/chat-memory.ts`). Because pi runs stateless, we assemble the context
ourselves before each turn:

- `buildChatContext` returns a rolling **summary** of older turns plus the
  un-summarized recent tail.
- After each turn, `maybeCompact` checks the tail size; once it crosses a character
  threshold, it folds all-but-the-last-few turns into the running summary with one cheap
  model call, and advances a `summarized_through_id` watermark.

State lives in the `chat_messages` and `chat_state` tables, so the conversation survives
restarts and page refreshes.

---

## 6. The Postgres data model

The schema is bootstrapped on boot with idempotent `CREATE TABLE IF NOT EXISTS`
statements (`src/core/db.ts`). Typed access lives in `PgStore` (`src/core/pg-store.ts`)
and the query helpers (`src/core/queries.ts`).

| Table | Purpose |
|---|---|
| **companies** | One row per company: `name`, `slug`, `profile` (JSONB: goal/stage/one-liner + deploy metadata like `website`, `repo`, `neon_project_id`, `render_service_id`), `autonomy`, `onboarded_at`, `sandbox_id` (persistent per-company sandbox), `proxy_token` (secret-proxy bearer). |
| **tasks** | The work queue. `title`, `description` (carries intent — the *what and why*), `tag`, `status` (`suggested`/`todo`/`in_progress`/`completed`/`failed`/`needs_continuation`/`blocked`/`rejected`), `priority` (0 low … 3 critical), `result` (JSONB summary+artifacts), `resume_note` (handoff for the next run), timestamps. |
| **task_events** | Append-only per-task timeline: `type` (status_change / reasoning / tool_call / tool_result / agent_text / note), `actor`, `payload`. Feeds the dashboard activity feed. |
| **executions** | One row per agent execution of a task: `agent`, `status`, `summary`, start/end. |
| **reports** | Saved deliverables: CEO daily summaries (`ceo_daily_summary`) and research reports, optionally linked to a `task_id`. Markdown `content`. |
| **documents** | The company knowledge base — one row per `(company, type)` for `mission`, `product_overview`, `tech_notes`, `brand_voice`, `user_research`. Injected into agent context. |
| **chat_messages** | The owner ↔ cofounder conversation, `role` + `content`, for persistence and compaction. |
| **chat_state** | Rolling chat compaction: the `summary` plus `summarized_through_id` watermark. |
| **visits** | First-party analytics: one row per beacon hit (`visitor_id`, `path`, `referer`, `ua`, `ts`) from deployed apps. |
| **context_graph** | Structured company knowledge nodes — one row per `(company, node_type)` (e.g. `company_profile`, `user_context`), JSONB `data`. |

---

## 7. The deploy pipeline

When the engineering agent calls `deploy_app`, the current workspace becomes a live
public URL. `deployApp` (`src/platform/deploy.ts`) ties the platform pieces together and
is idempotent — the first call provisions infrastructure; later calls just push and let
Render autodeploy.

```
  deploy_app tool
       │
       ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │ deployApp(companyId, slug, source)                               │
  │                                                                  │
  │  1. ensureProxyToken   → per-company bearer for the LLM proxy    │
  │  2. ensureRepo         → GitHub repo  polsia-<slug>  (private)    │
  │  3. push               → pushDir (host) or pushViaSandbox (cloud) │
  │  4. createNeonProject  → isolated Postgres → DATABASE_URL         │
  │  5. createRenderService→ Node web service, env injected:         │
  │        DATABASE_URL, POLSIA_ANALYTICS_SLUG, POLSIA_BEACON_URL,   │
  │        POLSIA_PROXY_URL, POLSIA_PROXY_TOKEN                       │
  │  6. record website/repo/neon/render ids on companies.profile     │
  └─────────────────────────────────────────────────────────────────┘
       │
       ▼
   live https://polsia-<slug>.onrender.com
```

**Source-agnostic push.** The files may live in a host directory (local Docker →
`pushDir`) or inside a remote sandbox (Daytona → `pushViaSandbox`, which runs git
*inside* the sandbox so the files never touch the control plane). GitHub auth works via
either `GITHUB_TOKEN` (tokened HTTPS remote) or an authenticated `gh` CLI.

**Per-app database.** Each deployed app gets its own isolated Neon Postgres project; the
connection URI is injected as `DATABASE_URL` at deploy time (`src/platform/neon.ts`).

**Analytics beacon.** Every built app ships with a first-party analytics beacon baked
into the starter template (`templates/express-postgres/server.js`) — an Express
middleware that injects a 1×1 pixel script into every HTML response. It's infrastructure,
not app code, so the engineering agent can rewrite every view and tracking still works.
The pixel pings `POLSIA_BEACON_URL/api/beacon/pixel?s=<slug>&v=<visitorId>&p=<path>`; the
control plane maps the slug to a company and records the visit. Those metrics feed the
CEO's daily report and the dashboard's Business snapshot.

**Per-company secret proxy for LLM keys.** Deployed apps never hold a raw LLM key.
Instead they call `POST /api/proxy/llm` with their per-company bearer token
(`POLSIA_PROXY_TOKEN`, injected at deploy time). The control plane validates the token
(`companyIdForProxyToken`) and forwards the request to the Anthropic Messages API with
*our* key (`src/platform/llm-proxy.ts`). The proxy accepts an OpenAI
`chat.completions`-style body and returns an OpenAI-style response — so agent-generated
app code can simply point an OpenAI SDK's `baseURL` at the control plane — and caps
`max_tokens` per request.

---

## 8. The dashboard / control server

`src/services/dashboard.ts` is a self-contained Node HTTP server that is the operator's
window and the app plane's ingress. It:

- serves the retro/ASCII dashboard page and streams live state from `/api/state`;
- runs the **chat orchestrator** over `/api/chat` (SSE-streamed);
- exposes the **autonomy gate UI**: approve/reject suggested tasks, run-links, manual
  cron trigger, onboarding, reset, and a worker on/off switch;
- runs a **continuous background worker** (`workerTick`, every 3s) that drains ad-hoc
  `todo`/`needs_continuation` work one task at a time (a single `busy` lock is shared
  with the daily cron so only one execution runs at once);
- terminates the **beacon** (`/api/beacon/pixel`, public) and the **secret proxy**
  (`/api/proxy/llm`, token-gated).

**Auth gate.** If `POLSIA_DASHBOARD_PASSWORD` is set (cloud deploy), everything except
the public beacon and the token-gated proxy requires HTTP Basic auth. Unset (local dev)
means open access.
