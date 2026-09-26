// Haggle vendor protocol: the contract between the auctioneer (~/haggle) and each vendor bot.
// Self-contained (only depends on zod) so it can be copied verbatim into ~/haggle.
// Nothing in here ever carries cost or floor prices - those stay inside the bot.
import { z } from "zod";

// 1.1: `engine` is "scripted" or "<provider>:<model>"; /quote and /award may require a swarm key.
// 1.2: POST /match - a bot says whether it would take part, given the shopper's own words
//      (`request`) or a structured intent; the reply includes the intent it understood.
export const PROTOCOL_VERSION = "1.2";
export const ROUNDS = 3;
export const LATE_PENALTY = 25; // how much the buyer dislikes missing the deadline, in £

/* ------------------------------------------------------------------ */
/* Shared shapes                                                        */
/* ------------------------------------------------------------------ */
export const IntentSchema = z.object({
  category: z.string(),
  categoryLabel: z.string(),
  budget: z.number().nullable(),
  deadlineDays: z.number().nullable(),
  deadlineLabel: z.string().nullable(),
  priorities: z.string(),
  summary: z.string(),
});
export type Intent = z.infer<typeof IntentSchema>;

/** A perk as the outside world sees it: no cost to the merchant. */
export const PublicPerkSchema = z.object({
  id: z.string(),
  label: z.string(),
  valueToBuyer: z.number(),
  deliveryDays: z.number().optional(),
  categories: z.array(z.string()).optional(),
});
export type PublicPerk = z.infer<typeof PublicPerkSchema>;

export const PublicProductSchema = z.object({
  handle: z.string(),
  category: z.string(),
  title: z.string(),
  description: z.string(),
  price: z.number(), // list price
  emoji: z.string(),
  image: z.string().optional(),
  inStock: z.boolean(),
});
export type PublicProduct = z.infer<typeof PublicProductSchema>;

/* ------------------------------------------------------------------ */
/* GET /card                                                            */
/* ------------------------------------------------------------------ */
export const CardSchema = z.object({
  protocolVersion: z.string(),
  id: z.string(),
  name: z.string(),
  tagline: z.string(),
  logo: z.string(),
  accent: z.string(),
  personality: z.string(),
  categories: z.array(z.string()),
  deliveryDays: z.number(),
  perks: z.array(PublicPerkSchema),
  products: z.array(PublicProductSchema),
  engine: z.string(), // "scripted" or "<provider>:<model>", e.g. "xai:grok-4.7"
  store: z.enum(["shopify", "mock"]),
  endpoints: z.object({ match: z.string(), quote: z.string(), award: z.string(), policy: z.string(), admin: z.string() }),
});
export type Card = z.infer<typeof CardSchema>;

/* ------------------------------------------------------------------ */
/* POST /match  (would this bot take part? call before round 1)         */
/* ------------------------------------------------------------------ */
export const MatchRequestSchema = z
  .object({
    protocolVersion: z.string().optional(),
    auctionId: z.string().optional(),
    // The shopper's conversational request, e.g. "im looking for a coffee machine for under £500"...
    request: z.string().trim().min(2).max(500).optional(),
    // ...or an intent the auctioneer has already worked out (wins if both are sent).
    intent: IntentSchema.optional(),
  })
  .refine((m) => m.request || m.intent, { message: "Send `request` (the shopper's words) or `intent`." });
export type MatchRequest = z.infer<typeof MatchRequestSchema>;

export const MatchResponseSchema = z.object({
  merchantId: z.string(),
  include: z.boolean(),
  intent: IntentSchema, // what the bot understood; reuse it for /quote
  // Categories only - a bot never says by how much it misses a budget.
  reason: z.enum(["ok", "not_stocked", "out_of_stock", "over_budget"]),
  message: z.string(),
  product: PublicProductSchema.nullable(), // what it would offer, when include is true
  deliveryDays: z.number().nullable(), // fastest delivery it can offer for this category
  meetsDeadline: z.boolean().nullable(), // late bids still count, with the buyer's late penalty
});
export type MatchResponse = z.infer<typeof MatchResponseSchema>;

/* ------------------------------------------------------------------ */
/* POST /quote  (request for quote, one per bot per round)              */
/* ------------------------------------------------------------------ */
/** One row of the public leaderboard - what every bot is allowed to see. */
export const BoardEntrySchema = z.object({
  merchantId: z.string(),
  name: z.string(),
  status: z.enum(["bidding", "withdrawn", "no_bid"]),
  price: z.number().nullable(),
  perks: z.array(z.string()), // labels
  perkValue: z.number(),
  deliveryDays: z.number().nullable(),
  score: z.number().nullable(),
});
export type BoardEntry = z.infer<typeof BoardEntrySchema>;

/** The bot's own standing bid, echoed back because bots are stateless. */
export const MyBidSchema = z.object({
  handle: z.string(),
  price: z.number(),
  perkIds: z.array(z.string()),
});
export type MyBid = z.infer<typeof MyBidSchema>;

export const QuoteRequestSchema = z.object({
  protocolVersion: z.string().optional(),
  auctionId: z.string(),
  round: z.number().int().min(1),
  rounds: z.number().int().min(1).default(ROUNDS),
  intent: IntentSchema,
  myBid: MyBidSchema.nullable().default(null),
  leaderboard: z.array(BoardEntrySchema).default([]),
  fast: z.boolean().optional(), // skip the theatrical pauses (tests, CI)
});
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

export const DecisionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("bid"),
    handle: z.string(),
    title: z.string(),
    price: z.number(),
    perkIds: z.array(z.string()),
    perks: z.array(z.string()),
    perkValue: z.number(),
    deliveryDays: z.number(),
    effective: z.number(),
    score: z.number(),
    message: z.string(),
  }),
  z.object({ action: z.literal("hold"), message: z.string() }),
  z.object({ action: z.literal("withdraw"), message: z.string() }),
]);
export type Decision = z.infer<typeof DecisionSchema>;

/** NDJSON events streamed by /quote. The stream always ends with `decision` then `done`. */
export type QuoteEvent =
  | { t: "hello"; merchantId: string; round: number; engine: string }
  | { t: "lot"; merchantId: string; product: PublicProduct; deliveryDays: number }
  | { t: "thinking"; agent: string }
  | { t: "tool"; agent: string; name: string; args: unknown; result: unknown; ms: number }
  // The floor itself is private: the event says a bid was blocked, not where the line is.
  | { t: "guardrail"; merchantId: string; attempted: number; perks: string[]; message: string }
  | { t: "decision"; merchantId: string; round: number; decision: Decision }
  | { t: "error"; message: string }
  | { t: "done" };

/* ------------------------------------------------------------------ */
/* POST /award                                                          */
/* ------------------------------------------------------------------ */
export const AwardRequestSchema = z.object({
  auctionId: z.string(),
  bid: MyBidSchema,
});
export type AwardRequest = z.infer<typeof AwardRequestSchema>;

export const AwardResponseSchema = z.object({
  merchantId: z.string(),
  code: z.string(),
  checkoutUrl: z.string(),
  listTotal: z.number(),
  finalPrice: z.number(),
  marginPct: z.number(),
  title: z.string(),
  perks: z.array(z.string()),
  expiresAt: z.number(),
  liveShopify: z.boolean(),
});
export type AwardResponse = z.infer<typeof AwardResponseSchema>;

/* ------------------------------------------------------------------ */
/* Scoring - how the buyer agent ranks bids (shared so both sides agree) */
/* ------------------------------------------------------------------ */
export function score(bid: { price: number; perkValue: number; deliveryDays: number }, intent: Intent) {
  let s = bid.price - bid.perkValue;
  if (intent.deadlineDays && bid.deliveryDays > intent.deadlineDays) s += LATE_PENALTY;
  if (intent.budget && bid.price > intent.budget) s += 1000;
  return s;
}
