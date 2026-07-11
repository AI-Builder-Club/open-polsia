// Sandbox — the execution-isolation seam.
// Phase 0: LocalDockerSandbox. Phase 2 swaps a managed service (Daytona/Blaxel/Firecracker).

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface Sandbox {
  /** Run a shell command inside the isolated workdir. */
  exec(command: string, opts?: { timeoutMs?: number }): Promise<ExecResult>;
  /** Absolute path of the workdir as seen by exec(). */
  workdir(): string;
  /** Copy a local template directory into the (empty) workdir — first run. */
  seed(localDir: string): Promise<void>;
  /** True if the workdir has no files yet (→ first run; else resume). */
  isEmpty(): Promise<boolean>;
  /** A live preview URL for a port, if the provider supports it (else null). */
  previewUrl(port: number): Promise<string | null>;
  /** Provider sandbox id to persist for reconnect (Option A); null for providers without it (docker). */
  id(): string | null;
  /** End this run but PRESERVE state for next time (docker: keep host dir; daytona: stop + archive). */
  release(): Promise<void>;
  /** Fully tear down + delete the sandbox (abandon / reset). */
  dispose(): Promise<void>;
}
