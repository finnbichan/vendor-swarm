import { PolicySchema, type Policy } from "../bot/schema";
import type { LlmTarget } from "./config";
import { completeJSON } from "./llm";

// Fallback parser when no LLM is configured: pull numbers out of the text.
export function parsePolicyHeuristic(text: string, base: Policy): Policy {
  const t = text.toLowerCase();
  const p: Policy = { ...base, strategy: text };
  const margin = t.match(/(\d{1,2})\s*%\s*(?:minimum\s*)?margin|margin[^.\d]*?(\d{1,2})\s*%/);
  if (margin) p.minMarginPct = Number(margin[1] ?? margin[2]);
  const clear = t.match(/clearance[^.]*?(\d{1,2})\s*%/);
  if (clear) p.clearanceMarginPct = Number(clear[1]);
  else if (p.clearanceMarginPct > p.minMarginPct) p.clearanceMarginPct = p.minMarginPct;
  const ttl = t.match(/(\d{1,4})\s*min(?:ute)?s?/);
  if (ttl) p.codeTtlMinutes = Number(ttl[1]);
  if (/no freebies|no perks|just price|price only|don'?t bundle|last resort/.test(t)) p.perksFirst = false;
  else if (/freebie|perk|throw in|bundle|warranty|case/.test(t)) p.perksFirst = true;
  return PolicySchema.parse(p);
}

/** Plain-English strategy -> enforced numbers. The vendor's model if configured, regex otherwise. */
export async function parseStrategy(
  strategy: string,
  current: Policy,
  target: LlmTarget | null,
  who: string,
): Promise<{ policy: Policy; parser: string }> {
  if (target) {
    try {
      const raw = (await completeJSON(
        target,
        who,
        `Convert a merchant's plain-English bidding strategy into JSON with exactly these keys:
minMarginPct (number 0-90: minimum gross margin % on normal items),
clearanceMarginPct (number: minimum margin % on clearance stock; if they say "clear harder" without a number use minMarginPct - 10; never above minMarginPct),
perksFirst (boolean: true if they want to add freebies/perks/bundles/warranty before cutting price, false if "just price"/"no freebies"/"perks as a last resort"),
codeTtlMinutes (int: how long discount codes stay valid).
Keep the current value for anything the text doesn't mention. Current: ${JSON.stringify(current)}`,
        strategy,
      )) as Partial<Policy>;
      return { policy: PolicySchema.parse({ ...current, ...raw, strategy }), parser: `${target.provider}:${target.model}` };
    } catch (e) {
      console.error("policy parse failed, using rules", (e as Error).message);
    }
  }
  return { policy: parsePolicyHeuristic(strategy, current), parser: "rules" };
}
