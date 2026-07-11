// Web-search ToolDef. Default provider Tavily — swappable for
// Brave/Exa/SerpAPI behind this same ToolDef. Reads TAVILY_API_KEY from env.
import { Type } from "@sinclair/typebox";
import type { ToolDef } from "./registry.ts";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

export function makeWebSearchTool(): ToolDef {
  return {
    name: "web_search",
    description: "Search the web. Returns a synthesized answer plus top source snippets (title, url, excerpt).",
    parameters: Type.Object({
      query: Type.String(),
      max_results: Type.Optional(Type.Number({ description: "default 5" })),
    }),
    async execute(raw) {
      const args = raw as { query: string; max_results?: number };
      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) return { ok: false, summary: "web_search unavailable: TAVILY_API_KEY not set." };
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            query: args.query,
            max_results: args.max_results ?? 5,
            search_depth: "basic",
            include_answer: true,
          }),
        });
        if (!res.ok) return { ok: false, summary: `web_search HTTP ${res.status}: ${await res.text()}` };
        const data = (await res.json()) as { answer?: string; results?: TavilyResult[] };
        const sources = (data.results ?? [])
          .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.content.slice(0, 300)}`)
          .join("\n");
        const summary = `${data.answer ? `ANSWER: ${data.answer}\n\n` : ""}SOURCES:\n${sources}`;
        return { ok: true, summary, data };
      } catch (err) {
        return { ok: false, summary: `web_search error: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}
