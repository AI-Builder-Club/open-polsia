// Dashboard server — self-contained Node http: REST + the retro/ASCII page (Criterion 7).
// Polls /api/state live; approve/reject suggested tasks (the autonomy gate's UI surface).
import { createServer, type IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getAgentStatus, getActivity, pushActivity } from "../core/status.ts";
import { PgStore } from "../core/pg-store.ts";
import { bootstrap, db, ensureCompany } from "../core/db.ts";
import {
  approveTask,
  companyIdForSlug,
  listMessages,
  nextAdHoc,
  queueCounts,
  recentEvents,
  recentReports,
  recordVisit,
  rejectTask,
  getReport,
  requeueOrphaned,
  resetCompany,
  saveMessage,
  visitMetrics,
  companyIdForProxyToken,
} from "../core/queries.ts";
import { proxyLlm } from "../platform/llm-proxy.ts";
import { runToCompletion } from "../core/worker.ts";
import { runDailyCron } from "../core/cron.ts";
import { runOnboarding } from "../agents/onboarding.ts";
import { PiRuntime } from "../runtime/pi.ts";
import { agents } from "../agents/index.ts";
import { withCompanyContext, getDocument } from "../core/memory.ts";
import { buildChatContext, maybeCompact } from "../core/chat-memory.ts";
import type { ToolContext } from "../tools/registry.ts";
import { PAGE } from "./dashboard-page.ts";

const COMPANY = "demo";
const store = new PgStore();
const runtime = new PiRuntime();

// Background worker — ON by default (set POLSIA_WORKER=off to disable, e.g. for cost-frozen demos).
// It drains the queue ONE task at a time (respecting the autonomy gate via dispatchNext). This is
// what makes chat-created / approved tasks actually execute, live in the feed.
let workerOn = process.env.POLSIA_WORKER !== "off";
let busy = false; // single execution lock shared by the ad-hoc worker AND the daily cron.
async function workerTick() {
  if (!workerOn || busy) return;
  busy = true;
  try {
    const id = await nextAdHoc(COMPANY); // chat/approved todo + resume in-flight; NOT suggested
    if (id) await runToCompletion(store, runtime, id); // no CEO review for ad-hoc work
  } catch (err) {
    console.error("[worker]", err);
  } finally {
    busy = false;
  }
}
setInterval(() => void workerTick(), 3000);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
}

/** Run the orchestrator (chat agent, no bash) on the user's message → it may create_task → todo. */
type ChatEvent = { type: "text"; delta: string } | { type: "tool"; name: string };

async function chat(message: string, baseUrl: string, onEvent?: (e: ChatEvent) => void): Promise<string> {
  // J.7 Path B: pi runs stateless — WE supply memory (rolling summary + recent tail), owned in our DB.
  const context = await buildChatContext(COMPANY); // before saving the new turn
  await saveMessage(COMPANY, "user", message);
  const prompt = context ? `${context}\n\nUser: ${message}` : message;

  const ctx: ToolContext = {
    taskId: "chat",
    log: (type, payload) => {
      pushActivity("chat", type, payload);
      if (type === "tool_call") {
        const name = (payload as { name?: string })?.name;
        if (name) onEvent?.({ type: "tool", name });
      }
    },
  };
  let reply = "";
  for await (const ev of runtime.run({
    system: await withCompanyContext(COMPANY, agents.chat.prompt),
    prompt,
    tools: agents.chat.makeTools({ store, companyId: COMPANY, baseUrl }),
    toolCtx: ctx,
  })) {
    if (ev.type === "text") { reply += ev.text; onEvent?.({ type: "text", delta: ev.text }); }
    if (ev.type === "error") { reply += `\n[error] ${ev.message}`; onEvent?.({ type: "text", delta: `\n[error] ${ev.message}` }); }
  }
  reply = reply.trim();
  await saveMessage(COMPANY, "assistant", reply);
  await maybeCompact(COMPANY); // fold older turns into the summary if the tail grew
  return reply;
}

async function state() {
  const [counts, tasks, events, reports, co, docs, metrics] = await Promise.all([
    queueCounts(COMPANY),
    store.list(COMPANY),
    recentEvents(COMPANY, 50),
    recentReports(COMPANY, 10),
    db()<{ name: string; onboarded_at: Date | null; profile: { website?: string } }[]>`SELECT name, onboarded_at, profile FROM companies WHERE id=${COMPANY}`,
    db()<{ type: string; updated_at: Date }[]>`SELECT type, updated_at FROM documents WHERE company_id=${COMPANY} AND content<>'' ORDER BY type`,
    visitMetrics(COMPANY),
  ]);
  return {
    company: co[0]?.name ?? COMPANY,
    onboarded: !!co[0]?.onboarded_at,
    worker: workerOn,
    busy,
    counts,
    agent: getAgentStatus(), // who's running, their mood (→ ASCII face) + last message
    business: {
      // visitors now LIVE via the beacon; revenue stays a placeholder until Stripe (Phase 3).
      visitors: metrics.visitsToday,
      revenue: "$0.00",
      shippedToday: counts.completedToday,
      docs: docs.length,
    },
    documents: docs.map((d) => ({ type: d.type, updated: d.updated_at.toISOString().slice(0, 10) })),
    reports: reports.map((r) => ({ id: r.id, type: r.type, name: r.name, created: r.created_at.toISOString().slice(0, 10) })),
    website: co[0]?.profile?.website ?? null, // set by deployApp (Phase 2)
    tasks: tasks.map((t) => ({ id: t.id, tag: t.tag, priority: t.priority, status: t.status, title: t.title })),
    // Merge DB task_events (engineering/research) with the live ring (ceo/onboarding) → one feed.
    events: [
      ...events.map((e) => ({ ts: e.ts, actor: e.actor, type: e.type, text: typeof e.payload === "object" ? JSON.stringify(e.payload) : String(e.payload) })),
      ...getActivity().map((a) => ({ ts: a.ts, actor: a.actor, type: a.type, text: a.text })),
    ]
      .sort((a, b) => a.ts.getTime() - b.ts.getTime())
      .slice(-80)
      .map((e) => ({ ts: e.ts.toISOString().slice(11, 19), actor: e.actor, type: e.type, payload: e.text.slice(0, 140) })),
    report: reports[0]?.content ?? null,
  };
}

const FONTS_DIR = fileURLToPath(new URL("../../node_modules/geist/dist/fonts", import.meta.url));
const FONT_FILES: Record<string, string> = {
  "pixel.woff2": "geist-pixel/GeistPixel-Square.woff2",
  "sans.woff2": "geist-sans/Geist-Variable.woff2",
};

function send(res: import("node:http").ServerResponse, code: number, body: string, type = "application/json") {
  res.writeHead(code, { "content-type": type });
  res.end(body);
}

async function main() {
  await bootstrap();
  await ensureCompany(COMPANY, "BrewBox", "brewbox");
  const recovered = await requeueOrphaned(COMPANY); // crash recovery for tasks interrupted mid-run
  if (recovered) console.log(`↻ recovered ${recovered} interrupted task(s) → needs_continuation`);
  const port = Number(process.env.PORT ?? 4317);

  createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://localhost`);
      // Auth gate (cloud deploy): if POLSIA_DASHBOARD_PASSWORD is set, everything except the
      // public beacon requires HTTP Basic auth. Unset (local dev) = open.
      const password = process.env.POLSIA_DASHBOARD_PASSWORD;
      if (password && url.pathname !== "/api/beacon/pixel" && !url.pathname.startsWith("/api/proxy/")) {
        const expected = "Basic " + Buffer.from(`polsia:${password}`).toString("base64");
        if (req.headers.authorization !== expected) {
          res.writeHead(401, { "www-authenticate": 'Basic realm="polsia"' });
          return res.end("auth required");
        }
      }
      if (url.pathname === "/") return send(res, 200, PAGE, "text/html; charset=utf-8");
      const font = url.pathname.match(/^\/fonts\/([\w.]+)$/);
      if (font && FONT_FILES[font[1]]) {
        const buf = readFileSync(`${FONTS_DIR}/${FONT_FILES[font[1]]}`);
        res.writeHead(200, { "content-type": "font/woff2", "cache-control": "max-age=86400" });
        return res.end(buf);
      }
      // Phase 2 — analytics beacon. Every built app pings this (?s=slug&v=visitorId&p=path); we
      // record the hit and return a 1x1 gif. First-party infra — the app never decides to add it.
      if (url.pathname === "/api/beacon/pixel") {
        const slug = url.searchParams.get("s") ?? "";
        const cid = await companyIdForSlug(slug);
        if (cid) {
          await recordVisit(cid, {
            visitorId: url.searchParams.get("v") ?? undefined,
            path: url.searchParams.get("p") ?? undefined,
            referer: req.headers.referer,
            ua: req.headers["user-agent"],
          });
        }
        const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
        res.writeHead(200, { "content-type": "image/gif", "cache-control": "no-store" });
        return res.end(gif);
      }
      // Phase 2 — secret-proxy: deployed apps authenticate with their per-company bearer token
      // (POLSIA_PROXY_TOKEN, injected at deploy time); raw LLM keys never leave the control plane.
      if (url.pathname === "/api/proxy/llm" && req.method === "POST") {
        const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
        const proxyCompany = await companyIdForProxyToken(bearer);
        if (!proxyCompany) return send(res, 401, JSON.stringify({ error: "invalid proxy token" }));
        const result = await proxyLlm(JSON.parse((await readBody(req)) || "{}"));
        return send(res, result.status, JSON.stringify(result.json));
      }
      if (url.pathname === "/api/state") return send(res, 200, JSON.stringify(await state()));
      if (url.pathname === "/api/report" && req.method === "GET") {
        const id = Number(url.searchParams.get("id"));
        return send(res, 200, JSON.stringify(await getReport(COMPANY, id)));
      }
      if (url.pathname === "/api/document" && req.method === "GET") {
        const type = url.searchParams.get("type") ?? "";
        return send(res, 200, JSON.stringify({ type, content: await getDocument(COMPANY, type) }));
      }
      if (url.pathname === "/api/messages" && req.method === "GET") {
        return send(res, 200, JSON.stringify({ messages: await listMessages(COMPANY) }));
      }
      const m = url.pathname.match(/^\/api\/(approve|reject)\/([a-z0-9]+)$/);
      if (m && req.method === "POST") {
        m[1] === "approve" ? await approveTask(m[2]) : await rejectTask(m[2]);
        return send(res, 200, JSON.stringify({ ok: true }));
      }
      if (url.pathname === "/api/worker" && req.method === "POST") {
        workerOn = url.searchParams.get("on") === "true";
        return send(res, 200, JSON.stringify({ ok: true, worker: workerOn }));
      }
      if (url.pathname === "/api/reset" && req.method === "POST") {
        if (busy) return send(res, 200, JSON.stringify({ ok: false, reason: "busy" }));
        await resetCompany(COMPANY);
        return send(res, 200, JSON.stringify({ ok: true }));
      }
      if (url.pathname === "/api/onboard" && req.method === "POST") {
        if (busy) return send(res, 200, JSON.stringify({ ok: false, reason: "busy" }));
        const { idea } = JSON.parse((await readBody(req)) || "{}");
        if (!idea) return send(res, 200, JSON.stringify({ ok: false, reason: "no idea" }));
        busy = true;
        // Run onboarding → Day-1 cron in the background; the page polls /api/state to watch it scaffold.
        void (async () => {
          try {
            await resetCompany(COMPANY);
            await runOnboarding(runtime, COMPANY, String(idea));
            await runDailyCron(store, runtime, COMPANY); // Day 1: CEO seeds the first tasks (no auto-build)
          } catch (e) {
            console.error("[onboard]", e);
          } finally {
            busy = false;
          }
        })();
        return send(res, 200, JSON.stringify({ ok: true, started: true }));
      }
      if (url.pathname === "/api/cron" && req.method === "POST") {
        // The daily cron: run top proposal to completion → CEO review/report/propose.
        if (busy) return send(res, 200, JSON.stringify({ ok: false, reason: "busy" }));
        busy = true;
        try {
          const r = await runDailyCron(store, runtime, COMPANY);
          return send(res, 200, JSON.stringify({ ok: true, ...r }));
        } finally {
          busy = false;
        }
      }
      if (url.pathname === "/api/chat" && req.method === "POST") {
        const { message } = JSON.parse((await readBody(req)) || "{}");
        // Stream the reply (SSE) so the user sees progress + tokens live instead of a long silent wait.
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        const emit = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
        try {
          const reply = await chat(String(message ?? ""), `http://localhost:${port}`, emit);
          emit({ type: "done", reply });
        } catch (err) {
          emit({ type: "done", reply: `[error] ${err instanceof Error ? err.message : String(err)}` });
        }
        return res.end();
      }
      // get_task_run_link target — click to run a specific task now.
      const run = url.pathname.match(/^\/run\/([a-z0-9]+)$/);
      if (run && req.method === "GET") {
        const t = await store.get(run[1]);
        if (t && (t.status === "todo" || t.status === "suggested" || t.status === "needs_continuation")) {
          if (t.status === "suggested") await approveTask(t.id);
          if (!busy) {
            busy = true;
            void runToCompletion(store, runtime, t.id).catch((e: unknown) => console.error(e)).finally(() => (busy = false));
          }
          return send(res, 200, `<body style="background:#0a0a0a;color:#39ff14;font-family:monospace;padding:2rem">▶ running task ${t.id} — watch the <a style="color:#e0b341" href="/">dashboard</a></body>`, "text/html");
        }
        return send(res, 200, `<body style="background:#0a0a0a;color:#e0b341;font-family:monospace;padding:2rem">task ${run[1]} is not runnable (status: ${t?.status ?? "not found"}). <a style="color:#e0b341" href="/">back</a></body>`, "text/html");
      }
      send(res, 404, JSON.stringify({ error: "not found" }));
    } catch (err) {
      send(res, 500, JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  }).listen(port, () => console.log(`▟ open-polsia dashboard → http://localhost:${port}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
