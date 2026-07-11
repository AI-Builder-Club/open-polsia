# open-polsia — Tool Inventory

Every agent capability in open-polsia is a `ToolDef` (`src/tools/registry.ts`) — a
`{ name, description, parameters (TypeBox schema), execute }` unit. Tools are defined
once in a runtime-neutral form and adapted to the agent runtime at run time, so an
agent's capability surface is exactly the set of tools its `makeTools()` returns.

This reference groups every tool by the agent(s) that expose it. Priorities are always
`0 low · 1 medium · 2 high · 3 critical`; tags are `engineering` (code/app/deploy) or
`research` (read-only web).

---

## Orchestrator tools — Chat cofounder

Exposed by `makeOrchestratorTools` (`src/tools/orchestrator.ts`); used **only** by the
chat agent. The orchestrator has no shell or filesystem — it manages the queue, inspects
executions, reads analytics, and reads/writes company documents.

### Queue: read & inspect

| Tool | Purpose | Parameters |
|---|---|---|
| `get_context` | Company info: name, profile, autonomy, available documents, report count, queue counts. | *(none)* |
| `get_tasks` | List current tasks (id, tag, priority, status, title). Use before creating to avoid duplicates. | `status?: string` |
| `get_task_details` | Full detail of one task: status, tag, priority, description, result summary, event count, resume note. | `task_id: string` |
| `get_task_execution_status` | Is a task currently running? Returns its status. | `task_id: string` |
| `get_task_execution_logs` | What the agent did on a task, step by step (recent events). | `task_id: string`, `limit?: number` |
| `get_active_executions` | What's running right now across all agents. | *(none)* |
| `query_reports` | List recent saved reports (CEO summaries, research deliverables). | `limit?: number` |

### Queue: manage

| Tool | Purpose | Parameters |
|---|---|---|
| `create_task` | Queue work directly as `todo` (user-authorized). | `title: string`, `description: string` (what AND why), `tag: "engineering"｜"research"`, `priority?: 0–3` |
| `edit_task` | Update a task's title, description, and/or priority. | `task_id: string`, `title?: string`, `description?: string`, `priority?: 0–3` |
| `reject_task` | Remove a task from the queue by id (duplicate / no longer needed). | `task_id: string`, `reason?: string` |
| `approve_task` | Promote a `suggested` task → `todo` (the autonomy gate). | `task_id: string` |
| `move_task_to_top` | Bump a task to run next (sets critical priority). | `task_id: string` |
| `reorder_task` | Reorder by setting a task's priority — the queue runs higher first. | `task_id: string`, `priority: 0–3` |
| `get_task_run_link` | Get a clickable URL that runs a specific task on click. | `task_id: string` |
| `find_best_agent` | Recommend the best agent tag for a task description (heuristic). | `query: string` |

### Company knowledge

| Tool | Purpose | Parameters |
|---|---|---|
| `get_document` | Read a company document (`mission`, `product_overview`, `tech_notes`, `brand_voice`, `user_research`). | `type: string` |
| `update_document` | Write/overwrite a company document. | `type: string`, `content: string` |

---

## Task lifecycle tools

Defined in `src/tools/tasks.ts` and split by privilege: creation is operator/agent
authorized; the terminal-state assertions belong to the execution agents themselves.

| Tool | Purpose | Parameters | Exposed to |
|---|---|---|---|
| `create_task` | Queue a unit of work as `todo` (ready to run). Routes by tag. | `title: string`, `description: string`, `tag: "engineering"｜"research"` | Chat orchestrator |
| `create_task_proposal` | Propose a unit of work — enters the queue as `suggested` (needs promotion via the autonomy gate). | `title: string`, `description: string`, `tag: "engineering"｜"research"`, `priority?: 0–3` | CEO / planner |
| `complete_task` | Assert THIS task is done. Only call after the deliverable exists. | `summary: string`, `artifacts: Artifact[]` | Engineering, Research |
| `fail_task` | Mark THIS task failed when the deliverable can't be produced. | `reason: string` | Engineering, Research |
| `resume_task` | Made progress but not finished this run → checkpoint to `needs_continuation` with a handoff note. | `note: string` | Engineering |

An **`Artifact`** is `{ type: "files"｜"pr"｜"deploy"｜"report"｜"inbox"｜"note", ref: string, note?: string }`.

> The task tools file also defines `get_tasks`, `reject_task`, and `set_priority`
> factory variants; the chat agent's active surface uses the richer orchestrator
> versions above.

---

## Sandbox tools — Engineering agent

`makeSandboxTools` (`src/tools/sandbox-tools.ts`). Every call routes through
`Sandbox.exec`, so all file and shell operations run **inside** the isolated sandbox
workdir — never on the control-plane host.

| Tool | Purpose | Parameters |
|---|---|---|
| `bash` | Run a shell command in the project workdir (inside the sandbox). Returns stdout/stderr + exit code. | `command: string` |
| `write_file` | Write (create/overwrite) a UTF-8 file at a path relative to the workdir. | `path: string`, `content: string` |
| `read_file` | Read a UTF-8 file (relative to workdir). | `path: string` |
| `ls` | List files (relative to workdir); defaults to the workdir root. | `path?: string` |

---

## Deploy tool — Engineering agent

`makeDeployTool` (`src/tools/deploy.ts`). Only attached when the company row exists.

| Tool | Purpose | Parameters |
|---|---|---|
| `deploy_app` | Deploy the current app to a live public URL — creates/uses its GitHub repo + Neon Postgres, pushes, and starts the Render service. Returns the URL. | *(none)* |

---

## Research & report tools — Research agent

| Tool | Purpose | Parameters | Source |
|---|---|---|---|
| `web_search` | Search the web; returns a synthesized answer plus top source snippets (title, url, excerpt). | `query: string`, `max_results?: number` (default 5) | `src/tools/web-search.ts` |
| `save_report` | Save the full deliverable as a markdown report (linked to the task). This IS the deliverable. | `name: string`, `content: string` | `src/tools/report.ts` |
| `complete_task` / `fail_task` | Terminal-state assertions (see task lifecycle above). | — | `src/tools/tasks.ts` |

---

## Onboarding tools — Onboarding agent

`makeOnboardingTools` (`src/tools/onboarding.ts`) plus `web_search` and `web_fetch`.
These set up a brand-new company from an idea — no sandbox, no code.

| Tool | Purpose | Parameters |
|---|---|---|
| `set_mood` | Set the live dashboard face: `thinking｜researching｜building｜shipped`. | `mood: string` |
| `set_company_profile` | Set the company's name + profile (must include industry, one-liner, stage, and a concrete GOAL). | `name`, `industry`, `one_liner`, `stage`, `goal` (all `string`) |
| `write_document` | Write a company document (`mission｜product_overview｜brand_voice`), specific to this company. | `type: string`, `content: string` |
| `set_context` | Save `user_context` (the founder's communication style / preferences) to the context graph. | `comm_style?: string`, `notes?: string` |
| `send_reply` | Post a short, warm welcome to the owner's chat (future tense for the build). | `message: string` |
| `finish_onboarding` | Mark onboarding complete once profile + documents + welcome are set. | *(none)* |

---

## CEO / planner tools

The CEO agent's surface is its `read_state` + `write_report` tools (`src/agents/ceo.ts`)
plus `create_task_proposal` (above).

| Tool | Purpose | Parameters |
|---|---|---|
| `read_state` | Read current queue counts, recently-completed tasks (what shipped), and traffic metrics. | *(none)* |
| `create_task_proposal` | Propose backlog work as `suggested` (see task lifecycle). | `title`, `description`, `tag`, `priority?` |
| `write_report` | Save the daily CEO report (one call). | `day_summary: string` |

---

## Shared web tools

| Tool | Purpose | Parameters | Used by |
|---|---|---|---|
| `web_search` | Search the web; synthesized answer + source snippets. | `query: string`, `max_results?: number` | Research, Onboarding |
| `web_fetch` | Fetch a URL and return its main text content (HTML stripped). | `url: string` | Onboarding |

---

## Tool-surface at a glance

| Agent | Tools |
|---|---|
| **Chat (orchestrator)** | `get_context`, `get_tasks`, `get_task_details`, `get_task_execution_status`, `get_task_execution_logs`, `get_active_executions`, `create_task`, `edit_task`, `reject_task`, `approve_task`, `move_task_to_top`, `reorder_task`, `get_task_run_link`, `find_best_agent`, `query_reports`, `get_document`, `update_document` |
| **CEO / planner** | `read_state`, `create_task_proposal`, `write_report` |
| **Engineering** | `bash`, `write_file`, `read_file`, `ls`, `complete_task`, `fail_task`, `resume_task`, `deploy_app` |
| **Research** | `web_search`, `save_report`, `complete_task`, `fail_task` |
| **Onboarding** | `set_mood`, `web_search`, `web_fetch`, `set_company_profile`, `write_document`, `set_context`, `send_reply`, `finish_onboarding` |
