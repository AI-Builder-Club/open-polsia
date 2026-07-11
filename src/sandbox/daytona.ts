// DaytonaSandbox — cloud execution isolation (Phase 2). Same Sandbox interface as LocalDockerSandbox,
// but runs in a managed Daytona sandbox and can expose a live preview URL for the built app.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Daytona, type Sandbox as DaytonaSb } from "@daytonaio/sdk";
import type { ExecResult, Sandbox } from "./types.ts";

function client(): Daytona {
  const apiKey = process.env.DAYTONA_API_KEY;
  if (!apiKey) throw new Error("DAYTONA_API_KEY not set");
  return new Daytona({ apiKey });
}

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...walk(abs, base));
    else out.push(abs);
  }
  return out;
}

export class DaytonaSandbox implements Sandbox {
  private constructor(
    private sb: DaytonaSb,
    private work: string,
  ) {}

  static async create(): Promise<DaytonaSandbox> {
    const sb = await client().create({ image: "node:22" }, { timeout: 120 });
    // Persist on stop: archive (don't auto-delete) so state survives between tasks for free (Option A).
    await sb.setAutoDeleteInterval(-1).catch(() => {}); // -1 = never auto-delete
    const root = (await sb.getUserRootDir()) ?? "/root";
    const work = `${root}/app`;
    await sb.process.executeCommand(`mkdir -p ${work}`);
    return new DaytonaSandbox(sb, work);
  }

  /** Reconnect to a stored sandbox (Option A resume): get it, then start() to restore from archive. */
  static async reconnect(sandboxId: string): Promise<DaytonaSandbox> {
    const sb = await client().get(sandboxId);
    if (sb.state !== "started") await sb.start(120); // un-archive / wake; warm FS incl node_modules
    const root = (await sb.getUserRootDir()) ?? "/root";
    return new DaytonaSandbox(sb, `${root}/app`);
  }

  async exec(command: string, opts?: { timeoutMs?: number }): Promise<ExecResult> {
    try {
      const r = await this.sb.process.executeCommand(command, this.work, undefined, Math.ceil((opts?.timeoutMs ?? 120_000) / 1000));
      return { exitCode: r.exitCode ?? 0, stdout: r.result ?? "", stderr: "" };
    } catch (err) {
      return { exitCode: 1, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Upload a local template dir into the workdir (first run). */
  async seed(localDir: string): Promise<void> {
    for (const abs of walk(localDir)) {
      const rel = relative(localDir, abs);
      const dest = `${this.work}/${rel}`;
      await this.exec(`mkdir -p "$(dirname '${dest}')"`);
      await this.sb.fs.uploadFile(readFileSync(abs), dest);
    }
  }

  async isEmpty(): Promise<boolean> {
    const r = await this.exec(`ls -A ${this.work} | head -1`);
    return r.stdout.trim() === "";
  }

  async previewUrl(port: number): Promise<string | null> {
    try {
      const link = await this.sb.getPreviewLink(port);
      return link.url ?? null;
    } catch {
      return null;
    }
  }

  workdir(): string {
    return this.work;
  }

  id(): string | null {
    return this.sb.id;
  }

  // Release = stop + archive: preserves the entire filesystem (incl node_modules) for free, so the
  // next task reconnects warm. The sandbox id is stored by the worker for reconnect.
  async release(): Promise<void> {
    try {
      await this.sb.stop();
      await this.sb.archive();
    } catch {
      /* best effort — a failed archive just means the next run may cold-start */
    }
  }

  async dispose(): Promise<void> {
    try {
      await this.sb.delete();
    } catch {
      /* best effort */
    }
  }
}
