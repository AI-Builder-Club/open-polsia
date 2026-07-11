// GitHub — per-company repo = the durable workspace + Render's deploy source (Phase 2).
// Two auth paths, same interface: GITHUB_TOKEN (prod/cloud — REST API + tokened git URL, no CLI
// needed) or the `gh` CLI (local dev, already authenticated).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const pExecFile = promisify(execFile);

const GITHUB_API = "https://api.github.com";

function token(): string | undefined {
  return process.env.GITHUB_TOKEN;
}

async function gh(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await pExecFile("gh", args, { cwd, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token()}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
}

export interface Repo {
  fullName: string; // owner/name
  url: string; // https URL (Render's repo field)
}

/** Create a private repo (idempotent: returns the existing one if it already exists). */
export async function ensureRepo(name: string, description = ""): Promise<Repo> {
  if (token()) {
    const me = await api("/user");
    if (!me.ok) throw new Error(`github /user ${me.status}`);
    const login = ((await me.json()) as { login: string }).login;
    const fullName = `${login}/${name}`;
    const existing = await api(`/repos/${fullName}`);
    if (existing.ok) return { fullName, url: `https://github.com/${fullName}` };
    const created = await api("/user/repos", {
      method: "POST",
      body: JSON.stringify({ name, description, private: true }),
    });
    if (!created.ok) throw new Error(`github repo create ${created.status}: ${(await created.text()).slice(0, 200)}`);
    return { fullName, url: `https://github.com/${fullName}` };
  }
  const me = await gh(["api", "user", "--jq", ".login"]);
  const fullName = `${me}/${name}`;
  try {
    const existing = await gh(["repo", "view", fullName, "--json", "url", "--jq", ".url"]);
    return { fullName, url: existing };
  } catch {
    await gh(["repo", "create", fullName, "--private", "--description", description]);
    return { fullName, url: `https://github.com/${fullName}` };
  }
}

/** Commit the contents of a local dir and push to the repo's default branch. */
export async function pushDir(localDir: string, repo: Repo, message = "polsia: update"): Promise<void> {
  const t = token();
  // With a token, embed it in the remote URL (x-access-token works for PATs and App tokens
  // alike); without one, plain https + gh's git credential helper.
  const remote = t
    ? `https://x-access-token:${t}@github.com/${repo.fullName}.git`
    : `${repo.url}.git`;
  if (!t) await pExecFile("gh", ["auth", "setup-git"]); // make gh the git credential helper for github.com
  const run = (a: string[]) => pExecFile("git", a, { cwd: localDir });
  await run(["init", "-q"]);
  await run(["checkout", "-B", "main"]);
  await run(["add", "-A"]);
  await run(["-c", "user.email=agent@polsia.local", "-c", "user.name=Polsia", "commit", "-q", "-m", message]).catch(() => {});
  await run(["remote", "remove", "origin"]).catch(() => {});
  await run(["remote", "add", "origin", remote]);
  await run(["push", "-u", "origin", "main", "--force"]);
}

/** Commit the sandbox's workdir and push it to the repo — for remote sandboxes (Daytona), where
 * the files never touch the control plane's filesystem. Commands are issued by the control plane
 * via sandbox.exec(); requires GITHUB_TOKEN. */
export async function pushViaSandbox(
  sandbox: { exec(cmd: string, opts?: { timeoutMs?: number }): Promise<{ exitCode: number; stdout: string; stderr: string }> },
  repo: Repo,
  message = "polsia: deploy",
): Promise<void> {
  const t = token();
  if (!t) throw new Error("GITHUB_TOKEN not set — required to deploy from a remote sandbox");
  const hasGit = await sandbox.exec("git --version");
  if (hasGit.exitCode !== 0) {
    const install = await sandbox.exec("apt-get update -qq && apt-get install -y -qq git", { timeoutMs: 180_000 });
    if (install.exitCode !== 0) throw new Error(`git unavailable in sandbox: ${install.stderr.slice(0, 200)}`);
  }
  const remote = `https://x-access-token:${t}@github.com/${repo.fullName}.git`;
  const script = [
    "git init -q",
    "git checkout -B main",
    "git add -A",
    `git -c user.email=agent@polsia.local -c user.name=Polsia commit -q -m ${JSON.stringify(message)} || true`,
    "git remote remove origin 2>/dev/null || true",
    `git remote add origin "${remote}"`,
    "git push -u origin main --force",
  ].join(" && ");
  const r = await sandbox.exec(script, { timeoutMs: 180_000 });
  if (r.exitCode !== 0) {
    // never leak the tokened remote URL into errors/logs
    const detail = `${r.stderr || r.stdout}`.replaceAll(t, "***").slice(0, 300);
    throw new Error(`sandbox git push failed: ${detail}`);
  }
}

export async function deleteRepo(fullName: string): Promise<void> {
  if (token()) {
    await api(`/repos/${fullName}`, { method: "DELETE" }).catch(() => {});
    return;
  }
  await gh(["repo", "delete", fullName, "--yes"]).catch(() => {});
}
