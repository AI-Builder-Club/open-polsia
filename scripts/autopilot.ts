// Autopilot — the daily cron (single mode). Each tick = one runDailyCron:
//   1. promote top `suggested` → run to FULL completion (resume immediately, capped)
//   2. if it completed → CEO review → report → propose + (re)prioritize the backlog
// Real cadence = a daily cron ('0 6 * * *'); for a watchable demo we tick on an interval.
//
// Run:  pnpm autopilot                       (1 tick, then exit)
//       POLSIA_TICKS=3 pnpm autopilot         (3 back-to-back daily cycles)
import { PgStore } from "../src/core/pg-store.ts";
import { bootstrap, ensureCompany, db } from "../src/core/db.ts";
import { PiRuntime } from "../src/runtime/pi.ts";
import { runDailyCron } from "../src/core/cron.ts";
import { queueCounts, requeueOrphaned } from "../src/core/queries.ts";

const COMPANY = "demo";

async function tick(store: PgStore, runtime: PiRuntime, n: number) {
  console.log(`\n┌── DAILY CRON ${n} ─ ${new Date().toISOString().slice(11, 19)} ──────────`);
  console.log("│ queue:", await queueCounts(COMPANY));
  await requeueOrphaned(COMPANY); // recover any task interrupted by a prior crash/restart
  const r = await runDailyCron(store, runtime, COMPANY);
  console.log(`\n│ ran: ${r.ranTaskId ?? "(nothing to run)"} → ${r.taskStatus ?? "-"}  · CEO reviewed: ${r.ceoRan}`);
  if (r.report) console.log(`│ report: ${r.report.slice(0, 180).replace(/\n/g, " ")}…`);
  console.log("└────────────────────────────────────────────");
}

async function main() {
  const ticks = Number(process.env.POLSIA_TICKS ?? 1);
  const interval = Number(process.env.POLSIA_INTERVAL_MS ?? 0);
  await bootstrap();
  await ensureCompany(COMPANY, "BrewBox", "brewbox");
  const store = new PgStore();
  const runtime = new PiRuntime();

  for (let i = 1; i <= ticks; i++) {
    await tick(store, runtime, i);
    if (interval > 0 && i < ticks) await new Promise((r) => setTimeout(r, interval));
  }
  await db().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
