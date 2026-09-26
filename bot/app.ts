// One vendor bot as a Hono app. Mounted at "/" by bot/server.ts (one process per port,
// local swarm) or at "/v/<id>" by bot/host.ts (all vendors in one process, Render).
import { timingSafeEqual } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { AwardRequestSchema, MatchRequestSchema, PROTOCOL_VERSION, QuoteRequestSchema, type Card } from "../protocol";
import { config, llmTarget } from "../lib/config";
import { ndjsonStream } from "../lib/events";
import { parseStrategy } from "../lib/policy";
import { adminPage, adminRoutes } from "./admin-routes";
import { isOwner, requireOwner, type Owner } from "./auth";
import { award, AwardError, storeFor } from "./award";
import { mockCheckoutPage } from "./checkout-page";
import { ConfigError, ConflictError, type VendorStore } from "./config-store";
import { matchIntent, publicProduct, quote } from "./merchant";
import { policyOf } from "./schema";

/* ---------------- shared middleware ---------------- */
function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Only the auctioneer may ask for quotes or awards once SWARM_API_KEY is set. */
export const requireSwarmKey: MiddlewareHandler = async (c, next) => {
  if (!config.swarmKey) return next();
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!safeEqual(token, config.swarmKey)) return c.json({ error: "Missing or wrong swarm key (Authorization: Bearer <SWARM_API_KEY>)." }, 401);
  return next();
};

/** Small in-memory fixed-window limiter, per vendor + client IP. */
export function rateLimit(max: number, windowMs = 60_000): MiddlewareHandler {
  const hits = new Map<string, { n: number; at: number }>();
  return async (c, next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? "local";
    const now = Date.now();
    const h = hits.get(ip);
    if (!h || now - h.at > windowMs) hits.set(ip, { n: 1, at: now });
    else if (++h.n > max) return c.json({ error: "Too many requests - slow down." }, 429);
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v.at > windowMs) hits.delete(k);
    return next();
  };
}

export const corsMw = () => cors({ origin: config.corsOrigins.includes("*") ? "*" : config.corsOrigins });

export const engineOf = (store: VendorStore) => {
  const t = llmTarget(store.current().vendor.llm);
  return t ? `${t.provider}:${t.model}` : "scripted";
};

/* ---------------- the vendor app ---------------- */
export function createVendorApp(store: VendorStore, opts: { publicUrl: string; log: (msg: string) => void }) {
  const { publicUrl, log } = opts;
  const vendorId = store.id;
  const app = new Hono<{ Variables: { owner: Owner } }>();

  app.use("/card", corsMw());
  // /match answers a yes/no budget question, so it's keyed and limited like /quote
  // (unlimited calls could narrow down a floor by varying the budget).
  app.use("/match", corsMw(), requireSwarmKey, rateLimit(120));
  app.use("/quote", corsMw(), requireSwarmKey, rateLimit(60));
  app.use("/award", corsMw(), requireSwarmKey, rateLimit(20));

  app.get("/", (c) => c.redirect(`${publicUrl}/card`));
  app.get("/health", (c) => c.json({ ok: true, vendor: vendorId, version: store.current().version }));

  app.get("/card", (c) => {
    const { vendor: v, catalog } = store.current();
    const products = catalog.products.filter((p) => !p.hidden);
    const card: Card = {
      protocolVersion: PROTOCOL_VERSION,
      id: v.id,
      name: v.name,
      tagline: v.tagline,
      logo: v.logo,
      accent: v.accent,
      personality: v.personality,
      categories: [...new Set(products.map((p) => p.category))],
      deliveryDays: v.deliveryDays,
      perks: v.perks.map(({ id, label, valueToBuyer, deliveryDays, categories }) => ({ id, label, valueToBuyer, deliveryDays, categories })),
      products: products.map(publicProduct),
      engine: engineOf(store),
      store: storeFor(v) ? "shopify" : "mock",
      endpoints: { match: `${publicUrl}/match`, quote: `${publicUrl}/quote`, award: `${publicUrl}/award`, policy: `${publicUrl}/policy`, admin: `${publicUrl}/admin/` },
    };
    return c.json(card);
  });

  app.post("/match", async (c) => {
    const parsed = MatchRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid match request", issues: parsed.error.issues }, 400);
    const r = matchIntent(store.current(), parsed.data.intent);
    log(`match ${parsed.data.intent.category}${parsed.data.intent.budget ? ` £${parsed.data.intent.budget}` : ""}: ${r.include ? "yes" : `no (${r.reason})`}`);
    return c.json(r);
  });

  app.post("/quote", async (c) => {
    const parsed = QuoteRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid RFQ", issues: parsed.error.issues }, 400);
    const snap = store.current(); // pinned for the whole turn, even if the owner saves mid-auction
    const req = parsed.data;
    log(`quote ${req.auctionId.slice(0, 8)} r${req.round} ${req.intent.category}${req.intent.budget ? ` £${req.intent.budget}` : ""}`);
    return ndjsonStream((emit) =>
      quote(snap, req, (e) => {
        if (e.t === "guardrail") log(`guardrail blocked £${e.attempted}`);
        if (e.t === "decision") log(`r${req.round} ${e.decision.action}${e.decision.action === "bid" ? ` £${e.decision.price}` : ""}`);
        emit(e);
      }),
    );
  });

  app.post("/award", async (c) => {
    const parsed = AwardRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid award", issues: parsed.error.issues }, 400);
    try {
      return c.json(await award(store.current(), parsed.data, publicUrl));
    } catch (e) {
      if (e instanceof AwardError) return c.json({ error: e.message }, e.status as 404 | 409 | 422);
      throw e;
    }
  });

  // Public callers get only the non-sensitive knobs; the owner gets the full policy.
  app.get("/policy", async (c) => {
    const p = policyOf(store.current().vendor);
    if (await isOwner(vendorId, c.req.header("authorization"))) return c.json({ vendorId, policy: p });
    return c.json({ vendorId, policy: { perksFirst: p.perksFirst, codeTtlMinutes: p.codeTtlMinutes } });
  });

  app.post("/policy", requireOwner(vendorId), async (c) => {
    const { strategy } = await c.req.json<{ strategy?: string }>().catch(() => ({ strategy: undefined }));
    if (!strategy?.trim()) return c.json({ error: "Send {strategy: string}" }, 400);
    const v = store.current().vendor;
    try {
      const { policy, parser } = await parseStrategy(strategy, policyOf(v), llmTarget(v.llm), vendorId);
      await store.save({ vendor: { ...store.current().vendor, ...policy } }, c.get("owner").email);
      log(`policy rewritten via ${parser}: ${policy.minMarginPct}% / clearance ${policy.clearanceMarginPct}%`);
      return c.json({ vendorId, policy, parser });
    } catch (e) {
      if (e instanceof ConflictError) return c.json({ error: e.message }, 409);
      if (e instanceof ConfigError) return c.json({ error: e.message, problems: e.problems }, 422);
      throw e;
    }
  });

  app.get("/checkout/mock", (c) => c.html(mockCheckoutPage(store.current().vendor, new URL(c.req.url).searchParams)));

  // Relative links in the admin page need the trailing slash.
  app.get("/admin", (c) => c.redirect(`${publicUrl}/admin/`));
  app.get("/admin/", adminPage);
  app.route("/admin", adminRoutes(store));

  app.onError((e, c) => {
    console.error(`[${vendorId}]`, e);
    return c.json({ error: "Internal error" }, 500);
  });
  return app;
}
