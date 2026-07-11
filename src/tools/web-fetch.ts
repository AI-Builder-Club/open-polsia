// web_fetch — fetch a URL and return its readable text (strip tags/scripts). For research grounding
// (onboarding, research agents). Swappable for a full readability extractor later.
import { Type } from "@sinclair/typebox";
import type { ToolDef } from "./registry.ts";

export function makeWebFetchTool(): ToolDef {
  return {
    name: "web_fetch",
    description: "Fetch a URL and return its main text content (HTML stripped). Use to read a page found via web_search.",
    parameters: Type.Object({ url: Type.String({ description: "absolute http(s) URL" }) }),
    async execute(raw) {
      const { url } = raw as { url: string };
      try {
        const res = await fetch(url, { headers: { "user-agent": "open-polsia/0.1" }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) return { ok: false, summary: `fetch failed: HTTP ${res.status}` };
        const html = await res.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&[a-z]+;/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
        return { ok: true, summary: text.slice(0, 4000), data: { url, length: text.length } };
      } catch (err) {
        return { ok: false, summary: `fetch error: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}
