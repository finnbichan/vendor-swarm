// All vendor bots in one process, each mounted at /v/<id> (Render free tier: one small
// service). Every vendor keeps its own store, admin page and login scope.
// Usage: tsx bot/host.ts   (VENDORS=aurora,crema to host a subset)
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { config, live, llmTarget } from "../lib/config";
import { understandRequest } from "../lib/intent";
import { PROTOCOL_VERSION } from "../protocol";
import { MatchRequestSchema } from "../protocol";
import { corsMw, createVendorApp, engineOf, rateLimit, requireSwarmKey } from "./app";
import { authConfig } from "./auth";
import { storeFor } from "./award";
import { listVendorIds, VendorStore } from "./config-store";
import { matchIntent } from "./merchant";
import { assertProductionReady } from "./prod-checks";

const all = listVendorIds();
const ids = process.env.VENDORS ? process.env.VENDORS.split(",").map((s) => s.trim()).filter(Boolean) : all;
const unknown = ids.filter((id) => !all.includes(id));
if (unknown.length) {
  console.error(`Unknown vendor(s) in VENDORS: ${unknown.join(", ")}`);
  process.exit(1);
}
assertProductionReady(ids);

const port = Number(process.env.PORT || 10000);
const base = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/$/, "");
const started = Date.now();

const stores = await Promise.all(ids.map((id) => VendorStore.open(id, (msg) => console.log(`[${id}] ${msg}`))));
const host = new Hono();
host.use("/vendors", corsMw());
host.use("/match", corsMw(), requireSwarmKey, rateLimit(60));

const vendorUrl = (id: string) => `${base}/v/${id}`;
for (const store of stores) host.route(`/v/${store.id}`, createVendorApp(store, { publicUrl: vendorUrl(store.id), log: (m) => console.log(`[${store.id}] ${m}`) }));

// Discovery for the auctioneer and scripts/mini-auction.mjs.
host.get("/vendors", (c) =>
  c.json({
    protocolVersion: PROTOCOL_VERSION,
    vendors: stores.map((s) => ({ id: s.id, name: s.current().vendor.name, logo: s.current().vendor.logo, cardUrl: `${vendorUrl(s.id)}/card` })),
  }),
);

// Ask every vendor at once whether it would take part - one call instead of eight.
host.post("/match", async (c) => {
  const parsed = MatchRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "Invalid match request", issues: parsed.error.issues }, 400);
  // Understand the request once (server default model, or rules) so every vendor judges the same intent.
  const { intent, parser } = parsed.data.intent
    ? { intent: parsed.data.intent, parser: "given" }
    : await understandRequest(parsed.data.request!, stores[0].current().categories, llmTarget(), "host");
  const results = stores.map((s) => ({
    ...matchIntent(s.current(), intent),
    name: s.current().vendor.name,
    logo: s.current().vendor.logo,
    cardUrl: `${vendorUrl(s.id)}/card`,
  }));
  console.log(`[host] match "${parsed.data.request ?? intent.summary}" -> ${intent.category} (${parser}): ${results.filter((r) => r.include).map((r) => r.merchantId).join(", ") || "nobody"}`);
  return c.json({ protocolVersion: PROTOCOL_VERSION, intent, parser, included: results.filter((r) => r.include).map((r) => r.merchantId), results });
});

host.get("/health", (c) =>
  c.json({
    ok: true,
    protocolVersion: PROTOCOL_VERSION,
    uptimeS: Math.round((Date.now() - started) / 1000),
    auth: authConfig().mode,
    swarmKey: !!config.swarmKey,
    tavily: live.tavily(),
    vendors: stores.map((s) => ({
      id: s.id,
      engine: engineOf(s),
      store: storeFor(s.current().vendor) ? "shopify" : "mock",
      storage: s.storage,
      configVersion: s.current().version,
    })),
  }),
);

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
host.get("/", (c) =>
  c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Haggle Vendors</title><style>
:root{--bg:#f6f5f2;--card:#fff;--ink:#18181b;--muted:#71717a;--line:#e4e4e7}
@media (prefers-color-scheme:dark){:root{--bg:#0e0e10;--card:#17171a;--ink:#f4f4f5;--muted:#a1a1aa;--line:#2a2a2e}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:32px 16px}
h1{font-size:22px;margin:0 0 4px}p{color:var(--muted);margin:0 0 20px}ul{list-style:none;padding:0;display:grid;gap:8px}
li{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.name{font-weight:600;flex:1;min-width:160px}.eng{font-family:ui-monospace,monospace;font-size:12px;color:var(--muted)}a{color:inherit}
</style></head><body><main><h1>Haggle vendor swarm</h1><p>${stores.length} vendor bots · protocol ${PROTOCOL_VERSION} · <a href="${base}/health">health</a> · <a href="${base}/vendors">vendors.json</a></p><ul>
${stores
  .map((s) => {
    const v = s.current().vendor;
    return `<li><span>${esc(v.logo)}</span><span class="name">${esc(v.name)}</span><span class="eng">${esc(engineOf(s))}</span><a href="${vendorUrl(s.id)}/card">card</a><a href="${vendorUrl(s.id)}/admin/">admin</a></li>`;
  })
  .join("")}
</ul></main></body></html>`),
);

serve({ fetch: host.fetch, port }, () => {
  console.log(
    `Haggle host on ${base} · ${stores.length} vendors · ${authConfig().mode} auth · ${config.swarmKey ? "swarm key on" : "swarm key OFF"} · ` +
      stores.map((s) => `${s.id}=${engineOf(s)}/${s.storage}`).join(" "),
  );
});
