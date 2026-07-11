// Run one CEO/Planner cycle in isolation (plan only): read state → propose tasks (suggested) →
// write daily report. Fast (no Docker). For the FULL daily cron (run a task + CEO), use `pnpm autopilot`.
//
// Run:  pnpm ceo
import { PgStore } from "../src/core/pg-store.ts";
import { bootstrap, ensureCompany, db } from "../src/core/db.ts";
import { PiRuntime } from "../src/runtime/pi.ts";
import { runCeoCycle } from "../src/agents/ceo.ts";
import { queueCounts } from "../src/core/queries.ts";

const COMPANY = "demo";

async function main() {
  await bootstrap();
  await ensureCompany(COMPANY, "BrewBox", "brewbox");
  const store = new PgStore();
  const runtime = new PiRuntime();

  console.log(`\n=== CEO CYCLE (plan only) ===\n`);
  console.log("before:", await queueCounts(COMPANY));

  const { report } = await runCeoCycle(store, runtime, COMPANY);

  console.log(`\n\n=== CYCLE RESULT ===`);
  console.log("after: ", await queueCounts(COMPANY));
  if (report) console.log(`\n--- daily report ---\n${report}`);

  console.log(`\n--- backlog (priority-ordered) ---`);
  for (const t of (await store.list(COMPANY)).sort((a, b) => b.priority - a.priority)) {
    console.log(`  p${t.priority} ${t.id} [${t.tag}] ${t.status.padEnd(14)} ${t.title}`);
  }
  await db().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
