import { config, live } from "../config";
import type { Product } from "../../bot/schema";

export type CompetitorResult = {
  source: "tavily" | "mock";
  query: string;
  prices: { store: string; price: number; url: string }[];
  min: number | null;
  median: number | null;
};

const cache = new Map<string, { at: number; data: CompetitorResult }>();

function summarise(query: string, source: CompetitorResult["source"], prices: CompetitorResult["prices"]): CompetitorResult {
  const sorted = [...prices].sort((a, b) => a.price - b.price);
  return {
    source,
    query,
    prices: sorted.slice(0, 5),
    min: sorted[0]?.price ?? null,
    median: sorted.length ? sorted[Math.floor(sorted.length / 2)].price : null,
  };
}

export async function competitorPrices(p: Product): Promise<CompetitorResult> {
  // Mock prices come straight from catalog.json so admin edits show up immediately.
  if (!live.tavily()) return summarise(p.comparatorQuery, "mock", p.mockCompetitors);
  const hit = cache.get(p.comparatorQuery);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.data;

  let data = summarise(p.comparatorQuery, "mock", p.mockCompetitors);
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.tavilyKey}` },
      body: JSON.stringify({ query: p.comparatorQuery, max_results: 8, search_depth: "basic", country: "united kingdom" }),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
    const found: CompetitorResult["prices"] = [];
    for (const r of json.results ?? []) {
      const matches = [...`${r.title} ${r.content}`.matchAll(/£\s?(\d{2,4}(?:\.\d{2})?)/g)].map((m) => Number(m[1]));
      // keep prices within a sane band around our list price
      const plausible = matches.filter((x) => x >= p.price * 0.5 && x <= p.price * 1.6);
      if (plausible.length) {
        const store = new URL(r.url).hostname.replace(/^www\./, "");
        found.push({ store, price: Math.min(...plausible), url: r.url });
      }
    }
    if (found.length) data = summarise(p.comparatorQuery, "tavily", found);
  } catch (e) {
    console.error("tavily failed, using mock", (e as Error).message);
  }
  cache.set(p.comparatorQuery, { at: Date.now(), data });
  return data;
}
