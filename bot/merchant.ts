// One merchant turn: given a request for quote, decide bid / hold / withdraw.
// Ported from ~/haggle lib/auction.ts, made stateless: everything the bot needs about the
// auction arrives in the request, and everything private (cost, floors) stays in here.
import { score, type BoardEntry, type Decision, type PublicProduct, type QuoteRequest } from "../protocol";
import type { Emit } from "../lib/events";
import { config, llmTarget, type LlmTarget } from "../lib/config";
import { runAgent, type ToolDef } from "../lib/llm";
import { floorPrice, perkValue, psychological } from "../lib/pricing";
import { competitorPrices } from "../lib/tools/tavily";
import type { Snapshot } from "./config-store";
import { policyOf, type Perk, type Policy, type Product, type Vendor } from "./schema";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type StandingBid = { price: number; perks: Perk[]; deliveryDays: number };

type Ctx = {
  vendor: Vendor;
  policy: Policy;
  product: Product;
  perks: Perk[]; // perks on offer for this category
  req: QuoteRequest;
  others: BoardEntry[]; // everyone else on the public board
  emit: Emit;
  bid: StandingBid | null; // our bid, updated if we place one this turn
  decision: Decision | null;
  target: LlmTarget | null;
  signal?: AbortSignal;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */
export const deliveryFor = (v: Vendor, perks: Perk[]) => Math.min(v.deliveryDays, ...perks.map((p) => p.deliveryDays ?? 99));

const scoreOf = (ctx: Ctx, b: StandingBid) =>
  score({ price: b.price, perkValue: perkValue(b.perks), deliveryDays: b.deliveryDays }, ctx.req.intent);

export function perkSubsets(perks: Perk[]): Perk[][] {
  const out: Perk[][] = [[]];
  for (const p of perks) for (const s of [...out]) out.push([...s, p]);
  return out;
}

export const publicProduct = (p: Product): PublicProduct => ({
  handle: p.handle,
  category: p.category,
  title: p.title,
  description: p.description,
  price: p.price,
  emoji: p.emoji,
  image: p.image,
  inStock: p.stock > 0,
});

/** Perks this vendor can offer for a category (add-ons must be in stock). */
export function perksFor(snap: Snapshot, category: string) {
  return snap.vendor.perks.filter((k) => {
    if (k.categories && !k.categories.includes(category)) return false;
    if (!k.addonHandle) return true;
    const addon = snap.catalog.products.find((p) => p.handle === k.addonHandle);
    return !!addon && addon.stock > 0;
  });
}

/** Stateless product choice: keep what we already bid with, otherwise the best kit that fits the budget. */
function pickProduct(snap: Snapshot, req: QuoteRequest, policy: Policy): Product | null {
  if (req.myBid) return snap.catalog.products.find((p) => p.handle === req.myBid!.handle) ?? null;
  const pool = snap.catalog.products.filter((p) => p.category === req.intent.category && !p.hidden && p.stock > 0);
  if (!pool.length) return null;
  const budget = req.intent.budget;
  if (budget) {
    const fits = pool.filter((p) => floorPrice(p, policy) <= budget).sort((a, b) => b.price - a.price);
    if (fits.length) return fits[0];
  }
  return [...pool].sort((a, b) => a.price - b.price)[0];
}

const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
const perkNote = (ps: Perk[]) => (ps.length ? ` with ${ps.map((p) => p.label.toLowerCase()).join(" and ")}` : "");

/**
 * Free text written by the model goes straight to the buyer, so it must not reveal cost or
 * floors. Any £ figure matching a private number (other than the price we're bidding) or
 * floor/cost talk gets swapped for the vendor's own scripted line.
 */
export function guardMessage(ctx: Pick<Ctx, "product" | "perks" | "policy" | "vendor">, message: string, fallback: string, bidPrice?: number) {
  const text = message.replace(/\s+/g, " ").trim().slice(0, 240);
  const secret = new Set<number>([ctx.product.cost]);
  for (const ps of perkSubsets(ctx.perks)) {
    secret.add(floorPrice(ctx.product, ctx.policy, ps));
    secret.add(ctx.product.cost + ps.reduce((s, k) => s + k.costToMerchant, 0));
  }
  const amounts = [...text.matchAll(/£\s?(\d+(?:\.\d+)?)/g)].map((m) => Math.round(Number(m[1])));
  const leaks = amounts.some((n) => n !== bidPrice && secret.has(n));
  const talk = /\bfloor\b|cost price|our cost|costs? us|we paid|margin is|minimum (?:price|is)/i.test(text);
  if (!text || leaks || talk) {
    console.warn(`[${ctx.vendor.id}] leak guard replaced a model message${leaks ? " (private figure)" : talk ? " (cost/floor talk)" : ""}`);
    return fallback;
  }
  return text;
}

function leader(ctx: Ctx): { id: string; name: string; score: number } | null {
  const rows = ctx.others
    .filter((o) => o.status === "bidding" && o.score !== null)
    .map((o) => ({ id: o.merchantId, name: o.name, score: o.score! }));
  if (ctx.bid) rows.push({ id: ctx.vendor.id, name: ctx.vendor.name, score: scoreOf(ctx, ctx.bid) });
  return rows.sort((a, b) => a.score - b.score)[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Actions (shared by the LLM tools and the scripted negotiator)        */
/* ------------------------------------------------------------------ */
function placeBid(ctx: Ctx, rawPrice: number, perkIds: string[], message: string) {
  const perks = ctx.perks.filter((p) => perkIds.includes(p.id));
  const floor = floorPrice(ctx.product, ctx.policy, perks);
  let price = Math.round(rawPrice);
  if (!Number.isFinite(price)) return { error: "Price must be a number." };
  if (price < floor) {
    ctx.emit({
      t: "guardrail",
      merchantId: ctx.vendor.id,
      attempted: price,
      perks: perks.map((p) => p.label),
      message: `Blocked £${price}: breaks ${ctx.vendor.name}'s margin rule.`,
    });
    return { error: `GUARDRAIL: £${price} with those perks breaks your margin rule. Minimum is £${floor}. Bid again at or above it, drop perks, hold or withdraw.` };
  }
  if (price > ctx.product.price) price = ctx.product.price;
  const budget = ctx.req.intent.budget;
  if (budget && price > budget)
    return { error: `£${price} is over the buyer's £${budget} budget and would be disqualified. Bid within budget (at or above your floor), drop perks, or withdraw.` };
  const bid: StandingBid = { price, perks, deliveryDays: deliveryFor(ctx.vendor, perks) };
  ctx.bid = bid;
  const s = scoreOf(ctx, bid);
  ctx.decision = {
    action: "bid",
    handle: ctx.product.handle,
    title: ctx.product.title,
    price,
    perkIds: perks.map((p) => p.id),
    perks: perks.map((p) => p.label),
    perkValue: perkValue(perks),
    deliveryDays: bid.deliveryDays,
    effective: price - perkValue(perks),
    score: s,
    message,
  };
  return { ok: true, price, perks: perks.map((p) => p.label), buyer_score: s };
}

const hold = (ctx: Ctx, message: string) => (ctx.decision = { action: "hold", message });
const withdraw = (ctx: Ctx, message: string) => (ctx.decision = { action: "withdraw", message });

function pricingPolicy(ctx: Ctx) {
  const deadline = ctx.req.intent.deadlineDays;
  return {
    list_price: ctx.product.price,
    stock: ctx.product.stock,
    options: perkSubsets(ctx.perks).map((ps) => ({
      perk_ids: ps.map((p) => p.id),
      perks: ps.map((p) => p.label),
      floor_price: floorPrice(ctx.product, ctx.policy, ps),
      buyer_value_of_perks: perkValue(ps),
      delivery_days: deliveryFor(ctx.vendor, ps),
      meets_deadline: deadline ? deliveryFor(ctx.vendor, ps) <= deadline : true,
    })),
  };
}

/** Tool events go out on the public stream, so private numbers are stripped first. */
function redactingEmit(emit: Emit): Emit {
  return (e) => {
    if (e.t !== "tool") return emit(e);
    let result = e.result as Record<string, unknown> | null;
    if (e.name === "get_pricing_policy") result = { private: true, options: (result?.options as unknown[] | undefined)?.length ?? 0 };
    else if (result && typeof result.error === "string") result = { error: result.error.replace(/ Minimum is £\d+\./, "") };
    emit({ ...e, result });
  };
}

/* ------------------------------------------------------------------ */
/* LLM negotiator (Grok)                                                */
/* ------------------------------------------------------------------ */
function tools(ctx: Ctx): ToolDef[] {
  return [
    {
      name: "get_pricing_policy",
      description:
        "Your confidential pricing rules for this item: list price, and for every combination of perks the minimum price you may bid (floor), the buyer's perceived value of the perks and the delivery time.",
      parameters: { type: "object", properties: {} },
      run: async () => pricingPolicy(ctx),
    },
    {
      name: "search_competitor_prices",
      description: "Search the web (Tavily) for what other retailers charge for a comparable product right now.",
      parameters: { type: "object", properties: {} },
      run: async () => competitorPrices(ctx.product),
    },
    {
      name: "place_bid",
      description: "Place or improve your bid. Rejected by a guardrail if it breaks your margin rule.",
      parameters: {
        type: "object",
        properties: {
          price: { type: "number", description: "Total price in GBP" },
          perk_ids: { type: "array", items: { type: "string" }, description: "Perks to include" },
          message: { type: "string", description: "One punchy sentence to the buyer (max 20 words)" },
        },
        required: ["price", "perk_ids", "message"],
      },
      run: async (a) => {
        const perkIds = (a.perk_ids as string[]) ?? [];
        const perks = ctx.perks.filter((p) => perkIds.includes(p.id));
        const price = Math.round(Number(a.price));
        const vars = { price, perks: perkNote(perks), rival: leader(ctx)?.name ?? "the others", margin: ctx.policy.minMarginPct };
        const line = fill(ctx.bid ? ctx.vendor.voice.counter : ctx.vendor.voice.opening, vars);
        return placeBid(ctx, price, perkIds, guardMessage(ctx, String(a.message ?? ""), line, price));
      },
    },
    {
      name: "hold",
      description: "Keep your current bid unchanged this round.",
      parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
      run: async (a) => (hold(ctx, guardMessage(ctx, String(a.message ?? ""), fill(ctx.vendor.voice.hold, { price: ctx.bid?.price ?? "", perks: "", rival: "", margin: ctx.policy.minMarginPct }))), { ok: true }),
    },
    {
      name: "withdraw",
      description: "Drop out of the auction (e.g. you can't win without breaking your rules).",
      parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
      run: async (a) =>
        (withdraw(ctx, guardMessage(ctx, String(a.message ?? ""), fill(ctx.vendor.voice.withdraw, { price: "", perks: "", rival: leader(ctx)?.name ?? "the others", margin: ctx.policy.minMarginPct }))), { ok: true }),
    },
  ];
}

function system(ctx: Ctx) {
  const { vendor: v, req, product } = ctx;
  const { intent, round, rounds } = req;
  const lines = ctx.others
    .map((o) =>
      o.status === "withdrawn"
        ? `- ${o.name}: withdrawn`
        : o.status === "bidding" && o.price !== null
          ? `- ${o.name}: £${o.price}${o.perks.length ? ` + ${o.perks.join(", ")}` : ""}, delivery ${o.deliveryDays}d (buyer score ${o.score})`
          : `- ${o.name}: no bid yet`,
    )
    .join("\n");
  const lead = leader(ctx);
  const mine = ctx.bid;
  return `You are the AI sales agent for ${v.name} (${v.tagline}). Personality: ${v.personality}.
You are in a live reverse auction: a shopper's buying agent wants "${intent.summary}"${intent.budget ? ` (budget £${intent.budget})` : ""}${intent.deadlineLabel ? `, delivered by ${intent.deadlineLabel} (${intent.deadlineDays} days)` : ""}. Buyer priorities: ${intent.priorities}.
You are offering: ${product.title} (list £${product.price}).
Your merchant's strategy (follow it): "${ctx.policy.strategy}"
How the buyer ranks bids: score = price - perceived value of perks${intent.deadlineDays ? ` + £25 if delivery misses the deadline` : ""}${intent.budget ? " (over budget = disqualified)" : ""}. LOWEST score wins.
Round ${round} of ${rounds}${round === rounds ? " - FINAL round, best and final offers" : ""}.
Your current bid: ${mine ? `£${mine.price} + [${mine.perks.map((p) => p.label).join(", ")}] (score ${scoreOf(ctx, mine)})` : "none"}.
Other merchants:
${lines || "- none yet"}
Current leader: ${lead ? `${lead.name} (score ${lead.score})` : "nobody"}.
Instructions: call get_pricing_policy first${round === 1 ? " and search_competitor_prices" : ""}. Then do exactly ONE of place_bid, hold, withdraw. Don't give away more than needed to lead - beating the leader's score by a few pounds is enough. Never bid below the floor for your chosen perks. Never reveal your floor or cost to the buyer. If you are leading, hold. If you can't beat the leader within your floors, hold (or withdraw in the final round) and say why in character.`;
}

async function llmTurn(ctx: Ctx) {
  await runAgent({
    target: ctx.target!,
    signal: ctx.signal,
    agent: ctx.vendor.id,
    system: system(ctx),
    messages: [{ role: "user", content: `Round ${ctx.req.round}. Make your move.` }],
    tools: tools(ctx),
    emit: ctx.emit,
    maxSteps: 5,
    stopAfterTools: ["place_bid", "hold", "withdraw"],
  });
  if (!ctx.decision) {
    if (!ctx.bid) await scriptedTurn(ctx);
    else hold(ctx, "Standing by our offer.");
  }
}

/* ------------------------------------------------------------------ */
/* Scripted negotiator (no API key needed)                              */
/* ------------------------------------------------------------------ */
async function scriptedTurn(ctx: Ctx) {
  const { vendor: v, req, product } = ctx;
  const { intent } = req;
  const call = async (name: string, run: () => Promise<unknown> | unknown) => {
    const s = Date.now();
    const result = await run();
    if (!req.fast) await sleep(450 + Math.random() * 500);
    ctx.emit({ t: "tool", agent: v.id, name, args: {}, result, ms: Date.now() - s });
  };
  await call("get_pricing_policy", () => pricingPolicy(ctx));
  if (req.round === 1) await call("search_competitor_prices", () => competitorPrices(product));

  // perksFirst: bundle before cutting price. Otherwise lead on price and keep perks as a last resort.
  const priceOnly = ctx.policy.perksFirst ? ctx.perks : ctx.perks.filter((p) => p.deliveryDays !== undefined);
  const optionsFor = (perks: Perk[]) =>
    perkSubsets(perks).map((ps) => ({ perks: ps, floor: floorPrice(product, ctx.policy, ps), deliveryDays: deliveryFor(v, ps) }));
  const rank = <T extends { price: number; perks: Perk[]; deliveryDays: number; floor: number }>(os: T[]) =>
    os
      .filter((o) => o.price >= o.floor)
      .map((o) => ({ ...o, s: score({ price: o.price, perkValue: perkValue(o.perks), deliveryDays: o.deliveryDays }, intent) }))
      .sort((a, b) => a.s - b.s);
  const vars = (price: number, perks: Perk[], rival = "") => ({ price, perks: perkNote(perks), rival, margin: ctx.policy.minMarginPct });

  if (!ctx.bid) {
    // Opening bid: modest discount off list, best-scoring perk combo
    const opening = rank(
      optionsFor(priceOnly).map((o) => {
        let price = Math.max(o.floor, psychological(product.price * (1 - v.scripted.openingDiscountPct / 100), o.floor));
        if (intent.budget) price = Math.min(price, intent.budget);
        return { ...o, price };
      }),
    )[0];
    if (!opening) {
      if (intent.budget) placeBid(ctx, intent.budget, [], ""); // try to meet the budget - the guardrail will stop it
      withdraw(ctx, `Can't meet a £${intent.budget} budget without breaking our margin rules.`);
      return;
    }
    placeBid(ctx, opening.price, opening.perks.map((p) => p.id), fill(v.voice.opening, vars(opening.price, opening.perks)));
    return;
  }

  const lead = leader(ctx);
  if (!lead || lead.id === v.id) {
    hold(ctx, fill(v.voice.hold, vars(ctx.bid.price, ctx.bid.perks)));
    return;
  }
  const target = lead.score - v.scripted.undercut;
  const counter = (perks: Perk[]) =>
    rank(
      optionsFor(perks).map((o) => {
        const penalty = intent.deadlineDays && o.deliveryDays > intent.deadlineDays ? 25 : 0;
        let price = Math.ceil(target + perkValue(o.perks) - penalty);
        price = Math.max(o.floor, psychological(price, o.floor));
        if (intent.budget) price = Math.min(price, intent.budget);
        return { ...o, price };
      }),
    ).filter((o) => o.s < lead.score)[0];
  const best = counter(priceOnly) ?? counter(ctx.perks); // last resort: every perk we have

  if (best) {
    placeBid(ctx, best.price, best.perks.map((p) => p.id), fill(v.voice.counter, vars(best.price, best.perks, lead.name)));
    return;
  }
  // We'd have to go below the floor to win. Try it anyway so the guardrail visibly says no.
  if (Math.ceil(target) < floorPrice(product, ctx.policy)) {
    const before = ctx.decision;
    placeBid(ctx, Math.ceil(target), [], "");
    ctx.decision = before;
  }
  const why = fill(v.voice.withdraw, vars(ctx.bid.price, ctx.bid.perks, lead.name));
  if (req.round >= req.rounds) withdraw(ctx, why);
  else hold(ctx, why);
}

/* ------------------------------------------------------------------ */
/* Entry point for POST /quote                                          */
/* ------------------------------------------------------------------ */
export async function quote(snap: Snapshot, req: QuoteRequest, rawEmit: Emit) {
  const v = snap.vendor;
  const emit = redactingEmit(rawEmit);
  const target = llmTarget(v.llm);
  const engine = target && !req.fast ? `${target.provider}:${target.model}` : "scripted";
  emit({ t: "hello", merchantId: v.id, round: req.round, engine });
  const decide = (decision: Decision) => emit({ t: "decision", merchantId: v.id, round: req.round, decision });

  const policy = policyOf(v);
  const product = pickProduct(snap, req, policy);
  if (!product) return decide({ action: "withdraw", message: `${v.name} doesn't stock ${req.intent.categoryLabel.toLowerCase()} right now.` });
  if (product.stock <= 0) return decide({ action: "withdraw", message: `Sold out of the ${product.title}.` });
  emit({ t: "lot", merchantId: v.id, product: publicProduct(product), deliveryDays: v.deliveryDays });

  const perks = perksFor(snap, req.intent.category);
  const my = req.myBid;
  const myPerks = my ? perks.filter((p) => my.perkIds.includes(p.id)) : [];
  const ctx: Ctx = {
    vendor: v,
    policy,
    product,
    perks,
    req,
    others: req.leaderboard.filter((e) => e.merchantId !== v.id),
    emit,
    bid: my ? { price: my.price, perks: myPerks, deliveryDays: deliveryFor(v, myPerks) } : null,
    decision: null,
    target,
  };

  emit({ t: "thinking", agent: v.id });
  if (engine === "scripted") await scriptedTurn(ctx);
  else {
    // The whole model turn gets a deadline; past it (or on any API error) the script takes over.
    const budget = new AbortController();
    const timer = setTimeout(() => budget.abort(new Error(`turn budget ${config.llm.turnBudgetMs}ms exceeded`)), config.llm.turnBudgetMs);
    ctx.signal = budget.signal;
    try {
      await llmTurn(ctx);
    } catch (e) {
      const reason = budget.signal.aborted ? String((budget.signal.reason as Error)?.message ?? "timeout") : (e as Error).message;
      console.error(`[${v.id}] model turn failed, falling back to script: ${reason}`);
      emit({ t: "tool", agent: v.id, name: "fallback", args: {}, result: { engine: "scripted", reason: reason.slice(0, 160) }, ms: 0 });
      if (!ctx.decision) await scriptedTurn(ctx);
    } finally {
      clearTimeout(timer);
    }
  }
  decide(ctx.decision ?? { action: "hold", message: "Standing by our offer." });
}
