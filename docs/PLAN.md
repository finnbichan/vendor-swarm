# haggle-vendors

A swarm of 8 independent AI vendor bots for **Haggle**, a reverse auction where stores' AI sales agents bid live for a shopper's cart. The auctioneer (`~/haggle`) will call these bots over HTTP using `protocol.ts`.

## Run it

```bash
npm install
npm run swarm                      # all 8 bots, ports 4101-4108 (or: npm run swarm -- aurora crema)
npm run host                       # production layout: all 8 in one process on :10000 at /v/<id>
npm run auction -- "noise cancelling headphones under £260 by Friday" --fast
open http://localhost:4101/admin   # owner page (local password: haggle-aurora)
```

Deployment (Render + Supabase + real models) is covered in [DEPLOY.md](DEPLOY.md).

Everything runs without keys. Copy `.env.example` to `.env` to switch on each integration:

| Integration | Env | Without it |
|---|---|---|
| LLM negotiator (any OpenAI-compatible provider, set per vendor) | `XAI_API_KEY`, `OPENAI_API_KEY`, … | Scripted negotiator (`scripted` block in vendor.json) |
| Tavily | `TAVILY_API_KEY` | `mockCompetitors` from catalog.json |
| Shopify (per vendor) | `<ID>_SHOPIFY_DOMAIN`, `<ID>_SHOPIFY_TOKEN` | Mock checkout page served by the bot |
| Supabase Auth | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Local password `<ID>_ADMIN_PASSWORD` (default `haggle-<id>`) |
| Supabase config storage | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `vendors/<id>/*.json` on disk |
| Swarm key | `SWARM_API_KEY` | `/quote` and `/award` open (local only; required in production) |

## Layout

```
protocol.ts              shared zod contract (copy into ~/haggle). Depends only on zod
bot/app.ts               createVendorApp(): /card /quote /award /policy /admin/ /checkout/mock for one vendor
bot/server.ts            one vendor per process (local swarm)
bot/host.ts              all vendors in one process at /v/<id>, plus /health /vendors / (Render)
bot/prod-checks.ts       refuses to boot in production without real secrets
bot/store-supabase.ts    Supabase backend for the config store (optimistic versioning, history, realtime)
bot/merchant.ts          one merchant turn: Grok tool loop or scripted, plus the guardrail
bot/award.ts             re-checks the floor, then issues a Shopify discount code or a mock one
bot/config-store.ts      VendorStore: load, validate, save and hot reload (file or Supabase backend)
bot/auth.ts              Supabase JWT or HMAC local sessions, scoped to this vendor
bot/admin-routes.ts      owner API. The only place costs are served, and only to the owner
bot/admin/               owner page (static HTML + ES module, no build step)
bot/schema.ts            private schemas (costs), cross-file validation
lib/                     ported from ~/haggle: pricing, llm, policy, events, tools/{shopify,tavily}
vendors/<id>/            vendor.json (persona, voice, rules, perks) + catalog.json (products, costs)
vendors/categories.json  7 categories with intent keywords
scripts/                 swarm, mini-auction, seed-shopify, create-admins, config-reset
supabase/migrations/     vendor_config + history tables
render.yaml              Render Blueprint; .github/workflows/keep-warm.yml pings /health
```

## Vendors

| Port | Vendor | Sells | Margin | Perks |
|---|---|---|---|---|
| 4101 | 🌌 Aurora Audio | headphones, earbuds, speaker | 25% | carry case (add-on), next-day |
| 4102 | ⚡ SoundHaus | audio, laptop, coffee, jacket* | 18% | express delivery (price-first) |
| 4103 | 🏔️ Northline | audio, jacket | 30% / 20% clearance | +1yr warranty, 60-day returns |
| 4104 | 👟 Stride Lab | trainers, jacket | 28% | gait fitting, second pair 50% off |
| 4105 | ☕ Crema & Co | coffee machine | 22% | 1 kg beans (add-on), barista call |
| 4106 | 💾 Byte Bazaar | laptop, earbuds | 12% | 2-yr warranty, sleeve (add-on) |
| 4107 | ⛰️ Peak Outfitters | jacket, trainers | 20% / 10% clearance | lifetime repairs |
| 4108 | 🛒 MegaMart | 6 of 7 (no speaker) | 10% | priority delivery, gift card (last resort) |

\* SoundHaus keeps its original Everyday Parka from `~/haggle`, because the brief said to keep existing products and handles. MegaMart can't cover all 7 categories within the 3-6 product limit, so it skips speaker, which already has 3 vendors. Every category has at least 3 vendors.

## Protocol (v1.2), see `protocol.ts`

What's new in 1.2:
- **`POST /match`** `{request}` or `{intent}` returns `{merchantId, include, reason, message, intent, product, deliveryDays, meetsDeadline, parser}`. It's the catalogue check: before round 1, the auctioneer asks each bot whether it would take part.
  - `request` is the shopper's own words, e.g. `"im looking for a coffee machine for under £500"`. The bot works out the category, budget and deadline with its model, or with keywords from `categories.json` if it has no key. It returns that `intent` so the auctioneer can reuse it for `/quote`.
  - A structured `intent` can be sent instead, and wins if both are sent.
  - A request that matches nothing sold becomes category `unknown`, and every bot declines with `not_stocked`.
  - `reason` is one of `ok`, `not_stocked`, `out_of_stock` or `over_budget`. It's never a number, so a bot doesn't reveal how far over budget it is.
  - It's instant and uses no model. It picks a product the same way as `/quote`, so `include: true` means the bot will bid.
  - A late bot still says yes, with `meetsDeadline: false`, because late bids count with the buyer's late penalty.
  - It needs the swarm key and is rate-limited. Unlimited budget probes could otherwise narrow down a floor.
  - On the host, **`POST /match`** understands the request **once** (with the server's default model, or rules) and asks all vendors about that same intent. It returns `{intent, parser, included: [ids], results: [...]}`, which is the call the auctioneer should make.

What's new in 1.1:
- `engine` is `"scripted"` or `"<provider>:<model>"`.
- When the host sets `SWARM_API_KEY`, `/quote` and `/award` require `Authorization: Bearer <SWARM_API_KEY>`.
- On a deployed host, bots live under `/v/<id>`. Discover them with `GET /vendors`.

Bots are stateless. Every `/quote` request carries everything the bot needs.

- **`POST /match`**: see above.
- **`GET /card`**: `{protocolVersion, id, name, tagline, logo, accent, personality, categories, deliveryDays, perks[{id,label,valueToBuyer,deliveryDays?,categories?}], products[{handle,category,title,description,price,emoji,image?,inStock}], engine, store, endpoints}`. It contains no cost, floor or perk cost.
- **`POST /quote`**: the request is `{auctionId, round, rounds, intent, myBid: {handle,price,perkIds} | null, leaderboard: BoardEntry[], fast?}`. The response is an NDJSON stream of `hello`, `lot`, `thinking`, `tool`, `guardrail`, then `decision`, then `done`. The decision is one of:
  - `{action:"bid", handle, title, price, perkIds, perks, perkValue, deliveryDays, effective, score, message}`
  - `{action:"hold", message}`
  - `{action:"withdraw", message}`
- **`POST /award`** `{auctionId, bid:{handle,price,perkIds}}` returns `{merchantId, code, checkoutUrl, listTotal, finalPrice, marginPct, title, perks, expiresAt, liveShopify}`. The bot re-checks its own floor first, so a tampered bid gets a 422.
- **`GET /policy`**: the public view is `{perksFirst, codeTtlMinutes}`, and the owner gets the full policy. **`POST /policy`** `{strategy}` (owner only) re-parses the strategy text with Grok, falling back to regex, and saves it.
- **Scoring** is shared in `protocol.ts` (`score()`): price minus perk value, +£25 if late, +1000 if over budget. Lowest wins.

### Privacy rules (enforced in code)
- Cost, floors and perk costs never leave the bot. `/card` and `/award` build their output from explicit public fields.
- Tool events on the `/quote` stream are redacted. `get_pricing_policy` becomes `{private:true, options:n}`, and guardrail errors lose the "Minimum is £X" text.
- The `guardrail` event says a bid was blocked, not where the floor is.
- `/admin/api/config` is the one exception. It is served only to an authenticated owner of that vendor.
- Model messages to the buyer pass through a leak guard (`guardMessage` in `bot/merchant.ts`). A message that mentions a cost or floor figure (other than the bid price), or talks about floors or costs, is replaced by the vendor's own line.
- Owners choose a model provider id, never a URL or a key env var, so an admin can't send a server key to a server they control.

## Owner admin page (`/admin` on each bot)

- **Rules:** the strategy text, with "Read numbers from text" (Grok or regex, shown as a diff before saving). Also the margin, clearance margin, code TTL, delivery days, perks-first switch, the scripted negotiator's knobs, and the perks table.
- **Catalogue:** an editable product table with a live floor and margin-at-list column. It supports add and delete. "More" shows the handle, emoji, image, comparator query, description and mock competitors.
- **Persona & voice:** name, tagline, logo, accent, personality, and the scripted lines (`{price} {perks} {rival} {margin}`).
- Saves are validated as a whole. A list price below the floor, clearance above normal margin, a missing add-on, a duplicate handle or an unknown category is rejected with a list of problems.
- Saves are written atomically (tmp file, then rename) and hot-reloaded. A `/quote` in progress keeps the snapshot it started with.
- Hand edits to the JSON files are picked up by a file watcher. Invalid edits are ignored with a log line.
- **Auth:**
  - With `SUPABASE_URL` and `SUPABASE_ANON_KEY` set, owners sign in with Supabase email and password. The bot verifies the JWT and requires `app_metadata.vendor_id === <this bot>`. `npm run admins -- --all` creates `<id>@haggle.dev` users with the service-role key.
  - Without Supabase, there's a local password and an HMAC session token (12 hours, 5 attempts per minute).
  - A token for one vendor is refused by every other bot.

## Shopify

1. Create a dev store and a custom app per vendor, with the Admin API scopes `write_products` and `write_discounts`. Set `<ID>_SHOPIFY_DOMAIN` and `<ID>_SHOPIFY_TOKEN`.
2. Run `npm run seed -- --vendor aurora` (or `--all`). This creates or updates products by handle, sets price and unit cost, and publishes them to the Online Store.
3. `/award` then creates a real single-use discount code, calculates the discount from Shopify's own list price, and returns a cart permalink. If a product is missing from the store, or Shopify fails, `/award` falls back to the mock checkout and logs why.

catalog.json is the source of truth for bidding. After editing prices on `/admin`, re-run the seed so the Shopify cart matches.

## Verification

```bash
npm run swarm &
# 1. cards on every port, no private fields
for p in $(seq 4101 4108); do curl -s localhost:$p/card | grep -Eci '"(cost|floor|costToMerchant)"'; done   # all 0
# 2. /quote streams and ends in a decision
curl -N localhost:4101/quote -H 'content-type: application/json' -d '{"auctionId":"t","round":1,"fast":true,
  "intent":{"category":"headphones","categoryLabel":"Headphones","budget":260,"deadlineDays":null,"deadlineLabel":null,"priorities":"value","summary":"ANC headphones"}}'
# 3. guardrail: a rival far below our floor
curl -N localhost:4101/quote -H 'content-type: application/json' -d '{"auctionId":"t","round":2,"fast":true,
  "intent":{"category":"headphones","categoryLabel":"Headphones","budget":260,"deadlineDays":null,"deadlineLabel":null,"priorities":"value","summary":"ANC headphones"},
  "myBid":{"handle":"aurora-anc-headphones","price":239,"perkIds":["case"]},
  "leaderboard":[{"merchantId":"megamart","name":"MegaMart","status":"bidding","price":150,"perks":[],"perkValue":0,"deliveryDays":6,"score":150}]}'
# 4. award (mock), and a below-floor award is refused
curl -s localhost:4101/award -H 'content-type: application/json' -d '{"auctionId":"t","bid":{"handle":"aurora-anc-headphones","price":230,"perkIds":["case"]}}'
curl -s localhost:4101/award -H 'content-type: application/json' -d '{"auctionId":"t","bid":{"handle":"aurora-anc-headphones","price":150,"perkIds":[]}}'
# 5. full auction across the swarm
npm run auction -- "running trainers under £140 by Friday" --fast
# 6. admin: 401 without a token, below-floor save rejected, a valid save reaches the next /quote
```

## Hand-off to ~/haggle (later step)

- Copy `protocol.ts`. `runAuction` becomes: fetch `/card` from each bot, open a `/quote` stream per bot per round (challengers in parallel, the leader last), relay the events to the UI, then `/award` the winner.
- The in-process merchants, `lib/catalog.ts` costs, `/api/policy` and the policy editor on `/merchant` are replaced by each bot's `/admin`.

## Not done yet
- Supabase *storage* was tested against local Postgres + PostgREST (the layer supabase-js uses): first-boot seed, save with a history row, the 409 on a stale save, the 30 s poll reload and `config:reset`. **Realtime** push hasn't been tested; until it is, outside edits arrive within 30 s by polling.
- Only a fake OpenAI-compatible server has been used to test the model path: tool loop, leak guard, JSON-mode fallback, timeout fallback and "Test model". It still needs one real run with a real key.
- Stock isn't decremented when an award is made, because bots are stateless. Shopify inventory is the real limit in live mode.
- Supabase Auth mode is written but hasn't been run against a real project. Local mode is tested end to end.
