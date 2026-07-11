// Status-integrity guard test:
// an agent that ends WITHOUT asserting complete_task/fail_task must become needs_continuation
// — never auto-completed. Uses a mock runtime so no LLM/Claude call is needed.
import { InMemoryStore } from "../src/core/store.ts";
import { runTask } from "../src/core/worker.ts";
import type { AgentRuntime, RunOpts } from "../src/runtime/types.ts";
import type { AgentEvent } from "../src/core/types.ts";

// A runtime that "works" but never calls complete_task/fail_task (simulates a killed/stalled run).
class NoCompleteRuntime implements AgentRuntime {
  async *run(_opts: RunOpts): AsyncIterable<AgentEvent> {
    yield { type: "text", text: "doing some work but never asserting completion..." };
    yield { type: "final", text: "" };
  }
}

async function main() {
  const store = new InMemoryStore();
  const task = await store.create({
    companyId: "test",
    title: "Task whose agent never completes",
    description: "Simulate an execution that ends without complete_task.",
    tag: "engineering",
  });

  await runTask(store, new NoCompleteRuntime(), task);

  const t = (await store.get(task.id))!;
  const pass = t.status === "needs_continuation";
  console.log(`\nguard test: task ${t.id} status=${t.status}`);
  console.log(pass ? "✅ PASS — not auto-completed (needs_continuation)" : `❌ FAIL — expected needs_continuation`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
