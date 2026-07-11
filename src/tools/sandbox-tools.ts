// Sandbox-backed coding tools — bash/write_file/read_file/ls routed through Sandbox.exec.
// These (not pi's host-bound built-ins) are what the engineering agent uses, so file/shell ops
// actually run INSIDE the Docker container. Swapping the Sandbox impl (Phase 2) needs no tool change.
import { Type } from "@sinclair/typebox";
import type { Sandbox } from "../sandbox/types.ts";
import type { ToolDef } from "./registry.ts";

const cap = (s: string, n = 4000) => (s.length > n ? s.slice(0, n) + "\n…(truncated)" : s);

export function makeSandboxTools(sb: Sandbox): ToolDef[] {
  const bash: ToolDef = {
    name: "bash",
    description: "Run a shell command in the project workdir (inside the sandbox). Returns stdout/stderr.",
    parameters: Type.Object({ command: Type.String() }),
    async execute(raw) {
      const { command } = raw as { command: string };
      const r = await sb.exec(command);
      return {
        ok: r.exitCode === 0,
        summary: `exit=${r.exitCode}\n${cap(r.stdout)}${r.stderr ? `\n[stderr]\n${cap(r.stderr)}` : ""}`,
        data: r,
      };
    },
  };

  const writeFile: ToolDef = {
    name: "write_file",
    description: "Write (create/overwrite) a UTF-8 file at a path relative to the workdir.",
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    async execute(raw) {
      const { path, content } = raw as { path: string; content: string };
      const b64 = Buffer.from(content, "utf8").toString("base64");
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
      const r = await sb.exec(`mkdir -p '${dir}' && printf %s '${b64}' | base64 -d > '${path}'`);
      return { ok: r.exitCode === 0, summary: r.exitCode === 0 ? `wrote ${path}` : r.stderr, data: r };
    },
  };

  const readFile: ToolDef = {
    name: "read_file",
    description: "Read a UTF-8 file (relative to workdir).",
    parameters: Type.Object({ path: Type.String() }),
    async execute(raw) {
      const { path } = raw as { path: string };
      const r = await sb.exec(`cat '${path}'`);
      return { ok: r.exitCode === 0, summary: r.exitCode === 0 ? cap(r.stdout) : r.stderr, data: r };
    },
  };

  const ls: ToolDef = {
    name: "ls",
    description: "List files (relative to workdir). Defaults to the workdir root.",
    parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    async execute(raw) {
      const { path } = raw as { path?: string };
      const r = await sb.exec(`ls -la '${path ?? "."}'`);
      return { ok: r.exitCode === 0, summary: cap(r.stdout) || r.stderr, data: r };
    },
  };

  return [bash, writeFile, readFile, ls];
}
