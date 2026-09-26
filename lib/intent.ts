// Turn a shopper's conversational request ("im looking for a coffee machine for under £500")
// into the structured intent the protocol uses. Ported from ~/haggle lib/auction.ts
// (understand / heuristicIntent / deadlineFromText), with categories from categories.json and
// an explicit "unknown" category when nothing we sell matches.
import type { Intent } from "../protocol";
import type { Category } from "../bot/schema";
import type { LlmTarget } from "./config";
import { completeJSON } from "./llm";

export const UNKNOWN = "unknown";
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function deadlineFromText(text: string): { days: number | null; label: string | null } {
  const t = text.toLowerCase();
  if (/\btomorrow\b/.test(t)) return { days: 1, label: "tomorrow" };
  if (/\btoday\b/.test(t)) return { days: 0, label: "today" };
  const inDays = t.match(/in (\d+) days?/);
  if (inDays) return { days: Number(inDays[1]), label: `in ${inDays[1]} days` };
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/London" })).getDay();
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${DAYS[i]}\\b`).test(t)) {
      const d = (i - today + 7) % 7 || 7;
      return { days: d, label: DAYS[i][0].toUpperCase() + DAYS[i].slice(1) };
    }
  }
  if (/next week/.test(t)) return { days: 7, label: "next week" };
  return { days: null, label: null };
}

export function budgetFromText(text: string): number | null {
  const t = text.toLowerCase().replace(/,/g, "");
  const b = t.match(/(?:under|below|max(?:imum)?|budget(?: of| is)?|up to|less than|no more than|around|about)\s*£?\s?(\d{2,5})|£\s?(\d{2,5})|(\d{2,5})\s*(?:quid|pounds|gbp)/);
  return b ? Number(b[1] ?? b[2] ?? b[3]) : null;
}

/** Keyword match against categories.json: the category whose matched keywords cover the most text wins. */
export function categoryFromText(text: string, categories: Category[]): Category | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9£ -]/g, " ")} `;
  const scored = categories
    .map((c) => ({ c, n: c.keywords.filter((k) => t.includes(` ${k} `) || t.includes(` ${k}s `) || t.includes(` ${k}es `)).reduce((s, k) => s + k.length, 0) }))
    .sort((a, b) => b.n - a.n);
  return scored[0]?.n ? scored[0].c : null;
}

function summaryOf(label: string, budget: number | null, deadline: string | null) {
  return `${label}${budget ? `, max £${budget}` : ""}${deadline ? `, delivered by ${deadline}` : ""}`;
}

export function parseIntentHeuristic(text: string, categories: Category[]): Intent {
  const cat = categoryFromText(text, categories);
  const budget = budgetFromText(text);
  const d = deadlineFromText(text);
  const label = cat?.label ?? "that item";
  return {
    category: cat?.id ?? UNKNOWN,
    categoryLabel: label,
    budget,
    deadlineDays: d.days,
    deadlineLabel: d.label,
    priorities: "best total value",
    summary: cat ? summaryOf(label, budget, d.label) : text.trim().slice(0, 80),
  };
}

/** Model understanding when a target is available, keyword rules otherwise (or if the model fails). */
export async function understandRequest(
  text: string,
  categories: Category[],
  target: LlmTarget | null,
  who: string,
): Promise<{ intent: Intent; parser: string }> {
  const base = parseIntentHeuristic(text, categories);
  if (!target) return { intent: base, parser: "rules" };
  try {
    const r = (await completeJSON(
      target,
      who,
      `You are a shopper's buying agent. Extract the purchase intent as JSON with keys:
category (one of ${categories.map((c) => c.id).join(", ")}, or "${UNKNOWN}" if the shopper wants something else),
budget (number in GBP or null),
priorities (short phrase: what matters beyond price),
summary (max 12 words, what you are buying for your human).`,
      text,
    )) as { category?: string; budget?: unknown; priorities?: string; summary?: string };
    const cat = categories.find((c) => c.id === r.category);
    const category = cat ? cat.id : r.category === UNKNOWN ? UNKNOWN : base.category;
    const label = categories.find((c) => c.id === category)?.label ?? "that item";
    const budget = typeof r.budget === "number" && r.budget > 0 ? r.budget : base.budget;
    return {
      intent: {
        ...base, // deadline stays rule-based: deterministic weekday maths beats a guess
        category,
        categoryLabel: label,
        budget,
        priorities: r.priorities || base.priorities,
        summary: r.summary || summaryOf(label, budget, base.deadlineLabel),
      },
      parser: `${target.provider}:${target.model}`,
    };
  } catch (e) {
    console.error(`[${who}] intent parse failed, using rules`, (e as Error).message);
    return { intent: base, parser: "rules" };
  }
}
