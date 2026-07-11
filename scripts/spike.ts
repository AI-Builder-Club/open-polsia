// Phase 1 E2E (persisted): prompt → orchestrator (no bash) → create_task → worker → engineering
// (sandboxed) → agent-asserted completion. State persists in Postgres; re-runs accumulate.
//
// Run:  pnpm spike "build a landing page for a coffee shop called Brew & Bean"
// Needs: Postgres (docker run … postgres) + Docker + a Claude login for pi.
import { PgStore } from "../src/core/pg-store.ts";
import { bootstrap, ensureCompany, db } from "../src/core/db.ts";
import { PiRuntime } from "../src/runtime/pi.ts";
import { runTask, workspaceDir } from "../src/core/worker.ts";
import { makeCreateTaskTool } from "../src/tools/tasks.ts";
import type { ToolContext } from "../src/tools/registry.ts";
import { agents } from "../src/agents/index.ts";

const COMPANY = "demo";

async function main() {
  const userPrompt = process.argv.slice(2).join(" ") || "build a simple landing page for a coffee shop";
  await bootstrap();
  await ensureCompany(COMPANY, "Demo Co", "demo");
  const store = new PgStore();
  const runtime = new PiRuntime();

  // ---- 1. Orchestrator turn (no bash; only create_task) ----
  console.log(`\n=== ORCHESTRATOR ===\n> ${userPrompt}\n`);
  const orchCtx: ToolContext = { taskId: "orchestrator", log: () => {} };
  const createTask = makeCreateTaskTool(store, COMPANY);
  for await (const ev of runtime.run({
    system: agents.chat.prompt,
    prompt: userPrompt,
    tools: [createTask],
    toolCtx: orchCtx,
  })) {
    if (ev.type === "text") process.stdout.write(ev.text);
    if (ev.type === "error") console.error(`\n[orchestrator error] ${ev.message}`);
  }

  // ---- 2. Worker drains the queue (dispatch by tag → engineering in a Docker sandbox) ----
  const task = await store.nextTodo(COMPANY);
  if (!task) {
    console.log("\n\n(no task queued — orchestrator did not create one)");
    await db().end();
    return;
  }
  console.log(`\n\n=== WORKER → ${task.tag.toUpperCase()} (task ${task.id}) ===\n`);
  await runTask(store, runtime, task);

  // ---- 3. Report (read back from Postgres — proves persistence) ----
  const t = (await store.get(task.id))!;
  console.log(`\n\n=== RESULT ===`);
  console.log(`task ${t.id} [${t.tag}] status=${t.status}   (persisted in Postgres)`);
  console.log(`app built in: ${workspaceDir(t.id)}`);
  console.log(`  → to view:  cd "${workspaceDir(t.id)}" && npm start   # then open http://localhost:3000`);
  if (t.result) console.log(`summary: ${t.result.summary}`);
  console.log(`\n--- activity timeline (${t.events.length} events) ---`);
  for (const e of t.events) {
    const p = typeof e.payload === "object" ? JSON.stringify(e.payload).slice(0, 110) : String(e.payload);
    console.log(`  ${new Date(e.ts).toISOString().slice(11, 19)} ${e.actor.padEnd(12)} ${e.type.padEnd(14)} ${p}`);
  }
  await db().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
