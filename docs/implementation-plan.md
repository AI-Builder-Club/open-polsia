# open-polsia — Implementation Plan & Roadmap

This is the phased build plan for open-polsia: an open-source autonomous AI
business-agent platform. Each phase is a coherent slice of capability that stands on its
own. Phases 0–2 are **built and working today**; Phases 3–4 are **planned**.

| Phase | Theme | Status |
|---|---|---|
| **Phase 0** | The core loop | ✅ Built |
| **Phase 1** | Persistent single-tenant platform | ✅ Built |
| **Phase 2** | The app plane (live deploys) | ✅ Built |
| **Phase 3** | Billing & credits | 🔜 Planned |
| **Phase 4** | Breadth: growth, multi-tenant, fleet | 🔜 Planned |

---

## Phase 0 — The core loop ✅

The minimum autonomous unit: an orchestrator turns intent into a task, a worker runs the
tagged agent inside a sandbox, and the agent asserts its own completion.

**Delivered:**

- **Neutral tool + runtime seams.** Tools are runtime-agnostic `ToolDef`s
  (`src/tools/registry.ts`); the `AgentRuntime` interface (`src/runtime/types.ts`)
  reduces any agent backend to `(system, prompt, tools) → event stream`. `PiRuntime`
  wraps the `pi` coding-agent SDK with no host bash/file leakage.
- **The task model.** Statuses (`suggested`/`todo`/`in_progress`/`completed`/`failed`/
  `needs_continuation`/`blocked`/`rejected`), tags, priorities, artifacts, and the
  `Store` persistence interface (`src/core/store.ts`).
- **The engineering agent, sandboxed.** `bash`/`write_file`/`read_file`/`ls` route
  through a `Sandbox` (`LocalDockerSandbox`) so nothing runs on the host.
- **The status-integrity guard.** The worker never auto-completes; a run that ends
  without `complete_task`/`fail_task` becomes `needs_continuation`.

---

## Phase 1 — Persistent single-tenant platform ✅

Everything a real company needs to run itself day after day: durable storage, an
autonomous planner, a daily beat, research, grounded memory, and a live dashboard.

**Delivered:**

- **Postgres persistence.** `PgStore` + a bootstrapped schema (`src/core/db.ts`):
  `companies`, `tasks`, `task_events`, `executions`, `reports`, `documents`,
  `chat_messages`, `chat_state`, `visits`, `context_graph`.
- **The CEO/planner autonomy loop.** `runCeoCycle` monitors state, keeps the `suggested`
  backlog ≥ 3, and writes a daily report. The **autonomy gate** (`suggested` → `todo`
  promotion) means proposals never run silently.
- **The daily cron.** `runDailyCron` promotes and runs the top proposal to full
  completion (resuming in place, capped), then triggers CEO review only on real
  completion.
- **Multi-run continuity.** `resume_task` handoff notes + workspace preservation +
  `requeueOrphaned` crash recovery let long tasks finish across runs.
- **The research agent.** Read-only web search → markdown report → asserted completion.
- **Memory / context model.** Company-context injection (`withCompanyContext`) grounds
  every agent in the profile, GOAL, documents, and context graph; DB-owned chat
  compaction (`src/core/chat-memory.ts`) keeps the cofounder conversation bounded.
- **The chat cofounder + dashboard.** A self-contained HTTP server
  (`src/services/dashboard.ts`) with a live retro/ASCII dashboard, an SSE chat
  orchestrator, the approve/reject autonomy-gate UI, and a continuous background worker.
- **The onboarding agent.** One-shot idea → name → profile + GOAL → documents → welcome
  → hand off to the Day-1 cron.

---

## Phase 2 — The app plane ✅

The agents don't just write code — they ship it to a live, publicly reachable URL, wired
back to the platform for analytics and LLM access.

**Delivered:**

- **Cloud sandboxes.** `DaytonaSandbox` behind the same `Sandbox` interface
  (`SANDBOX_PROVIDER=daytona`), with per-company warm persistence via stop+archive and
  reconnect-by-id (`companies.sandbox_id`).
- **The deploy pipeline.** `deploy_app` → `deployApp` (`src/platform/deploy.ts`):
  GitHub repo → push (from host dir or from inside the remote sandbox) → Neon Postgres
  (`DATABASE_URL`) → Render web service → live `*.onrender.com` URL, with infra ids
  recorded on the company. Idempotent: later calls just push and Render autodeploys.
- **First-party analytics beacon.** Baked into the starter template as infrastructure (a
  1×1 pixel injected into every HTML response), pinging `/api/beacon/pixel`; visits feed
  the CEO report and the dashboard Business snapshot.
- **Per-company secret proxy for LLM keys.** Deployed apps call `/api/proxy/llm` with a
  per-company bearer token (`POLSIA_PROXY_TOKEN`); the control plane forwards to the LLM
  with its own key. Apps never hold a raw secret. Accepts/returns an OpenAI-compatible
  shape (`src/platform/llm-proxy.ts`).
- **Deploy-time hardening.** HTTP Basic auth gate for the dashboard
  (`POLSIA_DASHBOARD_PASSWORD`), leaving the public beacon and token-gated proxy open.

---

## Phase 3 — Billing & credits 🔜 Planned

Turn the platform into something a customer pays for, with usage-based gating.

**Planned scope:**

- **Stripe subscriptions.** Plans, checkout, webhook-driven subscription state per
  company.
- **Credit ledger.** A metered ledger that accrues cost from agent runs, deploys, and
  proxied LLM calls.
- **Gating.** Enforce credit/subscription limits at the worker and the secret proxy
  (the dashboard already surfaces a revenue placeholder awaiting this phase).

---

## Phase 4 — Breadth: growth, multi-tenant, fleet 🔜 Planned

Widen the platform from one autonomous builder to a full company operating across many
tenants and channels.

**Planned scope:**

- **Growth agents.** New agent roles that drive distribution — Twitter/X, email, and ad
  channels — proposing and running growth tasks alongside engineering and research.
- **Multi-tenant ownership.** Real accounts and ownership so the single-tenant `demo`
  company becomes many isolated companies per owner.
- **Worker fleet / job queue.** Replace the single in-process `busy` lock with a real job
  queue and a horizontally scalable worker fleet, so many companies build in parallel.
- **Outcomes ledger for routing.** A historical record of task outcomes so `find_best_agent`
  routes on real data instead of the current heuristic.

---

### Legend

✅ Built — present and working in the codebase today.
🔜 Planned — designed for, not yet implemented.
