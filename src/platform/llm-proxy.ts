// Secret-proxy: LLM (Phase 2). Deployed apps call POST /api/proxy/llm with their per-company
// bearer token; we forward to Anthropic's Messages API with OUR key — the app never holds a raw
// LLM secret. Accepts an OpenAI chat.completions-style body (what agent-generated app code tends
// to write) and returns an OpenAI-style response, so apps can also point the OpenAI SDK's baseURL
// at the control plane. Non-streaming.
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-opus-4-8";
const MAX_TOKENS_CAP = 4096; // per-request cap for customer apps

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmProxyRequest {
  model?: string;
  messages?: ChatMessage[];
  prompt?: string; // convenience: bare prompt instead of a messages array
  max_tokens?: number;
}

export async function proxyLlm(body: LlmProxyRequest): Promise<{ status: number; json: unknown }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { status: 503, json: { error: "LLM proxy not configured" } };

  const incoming: ChatMessage[] = body.messages ?? (body.prompt ? [{ role: "user", content: body.prompt }] : []);
  if (!incoming.length) return { status: 400, json: { error: "messages or prompt required" } };

  const system = incoming.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const messages = incoming
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: String(m.content ?? "") }));
  // Apps may ask for gpt-* etc. — everything that isn't a Claude model maps to our default.
  const model = body.model?.startsWith("claude-") ? body.model : DEFAULT_MODEL;
  const maxTokens = Math.min(Math.max(1, body.max_tokens ?? 1024), MAX_TOKENS_CAP);

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, ...(system ? { system } : {}), messages }),
  });
  const data = (await res.json()) as {
    id?: string;
    model?: string;
    stop_reason?: string;
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { message?: string };
  };
  if (!res.ok) return { status: res.status === 429 ? 429 : 502, json: { error: data.error?.message ?? `upstream ${res.status}` } };

  const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  return {
    status: 200,
    json: {
      id: data.id,
      object: "chat.completion",
      model: data.model,
      choices: [{
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: data.stop_reason === "max_tokens" ? "length" : "stop",
      }],
      usage: {
        prompt_tokens: data.usage?.input_tokens ?? 0,
        completion_tokens: data.usage?.output_tokens ?? 0,
        total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
    },
  };
}
