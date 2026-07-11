// Sandbox provider switch. SANDBOX_PROVIDER=daytona → cloud (prod); default = local Docker (dev).
// Both satisfy the same Sandbox interface, so the worker is provider-agnostic.
//
// Option A persistence: for Daytona we reconnect to a stored sandbox id when present (warm, files +
// node_modules preserved via archive); else create a fresh one. Local Docker persists via the host dir.
import { LocalDockerSandbox } from "./local-docker.ts";
import { DaytonaSandbox } from "./daytona.ts";
import type { Sandbox } from "./types.ts";

export interface SandboxOpts {
  hostDir: string; // local Docker bind-mount + deploy source
  sandboxId?: string | null; // Daytona: reconnect to this if set
}

export async function createSandbox(opts: SandboxOpts): Promise<Sandbox> {
  if (process.env.SANDBOX_PROVIDER === "daytona") {
    if (opts.sandboxId) {
      try {
        return await DaytonaSandbox.reconnect(opts.sandboxId);
      } catch {
        // stored sandbox lost (auto-deleted / provider hiccup) → fall through to a fresh one.
      }
    }
    return DaytonaSandbox.create();
  }
  return LocalDockerSandbox.create(opts.hostDir);
}
