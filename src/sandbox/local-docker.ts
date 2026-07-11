// LocalDockerSandbox — Phase 0 isolation for the engineering agent's bash.
// One long-lived container with a mounted workdir; exec via `docker exec`.
// Phase 2 swaps a managed service behind the same Sandbox interface.
import { execFile } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ExecResult, Sandbox } from "./types.ts";

const pExecFile = promisify(execFile);
const IMAGE = "node:22-alpine";
const CONTAINER_WORKDIR = "/work";

export class LocalDockerSandbox implements Sandbox {
  private containerId = "";
  private hostDir = "";

  private constructor() {}

  /** Pass a stable hostDir to make the built app discoverable; omit for a throwaway temp dir. */
  static async create(hostDir?: string): Promise<LocalDockerSandbox> {
    const sb = new LocalDockerSandbox();
    sb.hostDir = hostDir ?? mkdtempSync(join(tmpdir(), "polsia-sbx-"));
    mkdirSync(sb.hostDir, { recursive: true });
    // Detached container kept alive; workdir bind-mounted; no host network access beyond default.
    const { stdout } = await pExecFile("docker", [
      "run", "-d", "--rm",
      "-v", `${sb.hostDir}:${CONTAINER_WORKDIR}`,
      "-w", CONTAINER_WORKDIR,
      IMAGE, "sleep", "infinity",
    ]);
    sb.containerId = stdout.trim();
    return sb;
  }

  async exec(command: string, opts?: { timeoutMs?: number }): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await pExecFile(
        "docker",
        ["exec", this.containerId, "sh", "-lc", command],
        { timeout: opts?.timeoutMs ?? 120_000, maxBuffer: 16 * 1024 * 1024 },
      );
      return { exitCode: 0, stdout, stderr };
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return {
        exitCode: typeof e.code === "number" ? e.code : 1,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? e.message ?? "exec failed",
      };
    }
  }

  workdir(): string {
    return this.hostDir; // host-side path (the bind-mount source)
  }

  // Bind-mounted host dir → seed by copying on the host; persistence is the host dir itself.
  async seed(localDir: string): Promise<void> {
    cpSync(localDir, this.hostDir, { recursive: true });
  }

  async isEmpty(): Promise<boolean> {
    return !existsSync(this.hostDir) || readdirSync(this.hostDir).length === 0;
  }

  async previewUrl(): Promise<string | null> {
    return null; // local Docker has no managed public URL
  }

  id(): string | null {
    return null; // no persistent id — the host bind-mount dir IS the persistence
  }

  // Release = remove the container; the host workdir persists on disk, so the next run resumes from it.
  async release(): Promise<void> {
    await this.dispose();
  }

  async dispose(): Promise<void> {
    if (this.containerId) {
      await pExecFile("docker", ["rm", "-f", this.containerId]).catch(() => {});
    }
  }
}
