// J.7 Path B — DB-owned chat memory. pi runs stateless; WE assemble the context (rolling summary +
// recent turns) and run a cheap-model compaction when the tail grows. Decoupled from pi's sessions.
import { getChatState, setChatSummary, messagesSince } from "./queries.ts";

const SUMMARIZE_AFTER_CHARS = Number(process.env.CHAT_SUMMARIZE_AFTER_CHARS ?? 12000); // ~3k tokens
const KEEP_RECENT = 6; // turns kept verbatim after a compaction
const HAIKU = "claude-haiku-4-5-20251001";

type Turn = { id: string; role: string; content: string };

function transcript(turns: { role: string; content: string }[]): string {
  return turns.map((m) => `${m.role === "user" ? "User" : "Polsia"}: ${m.content}`).join("\n\n");
}

/** Context to prepend to the agent prompt: rolling summary + the un-summarized recent tail. */
export async function buildChatContext(companyId: string): Promise<string> {
  const { summary, throughId } = await getChatState(companyId);
  const tail = await messagesSince(companyId, throughId);
  const parts: string[] = [];
  if (summary) parts.push(`Summary of earlier conversation:\n${summary}`);
  if (tail.length) parts.push(transcript(tail));
  return parts.join("\n\n");
}

/** One cheap-model call: fold older turns into the running summary. */
async function summarize(oldSummary: string, fold: Turn[]): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("no ANTHROPIC_API_KEY");
  const prompt =
    `You are compacting a conversation between a founder (User) and Polsia (their AI cofounder).\n` +
    `Update the running summary to preserve: the founder's goals/preferences/decisions, key facts ` +
    `established, what Polsia did or queued, and any open threads. Drop pleasantries and redundant ` +
    `detail. Be concise (under 200 words). Output ONLY the updated summary.\n\n` +
    `Existing summary:\n${oldSummary || "(none yet)"}\n\nNew turns to fold in:\n${transcript(fold)}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: HAIKU, max_tokens: 1024, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { content?: { text?: string }[] };
  return data.content?.[0]?.text?.trim() ?? oldSummary;
}

/** After a turn: if the recent tail is large, fold all-but-last-KEEP_RECENT into the summary. */
export async function maybeCompact(companyId: string): Promise<boolean> {
  const { summary, throughId } = await getChatState(companyId);
  const tail = await messagesSince(companyId, throughId);
  const chars = tail.reduce((n, m) => n + m.content.length, 0);
  if (chars < SUMMARIZE_AFTER_CHARS || tail.length <= KEEP_RECENT + 2) return false;
  const fold = tail.slice(0, tail.length - KEEP_RECENT);
  try {
    const next = await summarize(summary, fold);
    await setChatSummary(companyId, next, Number(fold[fold.length - 1].id));
    return true;
  } catch (err) {
    console.error("[chat-compact]", err instanceof Error ? err.message : err);
    return false; // chat keeps working; we just didn't compact this round
  }
}
