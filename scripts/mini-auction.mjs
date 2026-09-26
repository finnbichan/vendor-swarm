// A tiny auctioneer for testing the swarm without ~/haggle: parses a shopping request,
// runs a 3-round reverse auction over HTTP against every bot that sells the category,
// picks the best-value bid and asks the winner to issue a discount code.
// Usage: npm run auction -- "noise cancelling headphones under £260 by Friday" [--fast|--real] [--rounds 3] [--base URL]
//   --base https://haggle-vendors.onrender.com   discover bots on a deployed host via /vendors
//   --real                                        full-speed real models (default: fast scripted-speed turns)
// Sends SWARM_API_KEY from the environment (.env) as the bearer token.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const root = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const valued = ["--rounds", "--host", "--base"];
const request = args.filter((a, i) => !a.startsWith("--") && !valued.includes(args[i - 1])).join(" ") || "noise cancelling headphones under £260";
const ROUNDS = Number(opt("rounds", 3));
const LATE_PENALTY = 25; // keep in sync with protocol.ts
const fast = !flag("real"); // real models need the full, un-hurried turn
const auth = process.env.SWARM_API_KEY ? { Authorization: `Bearer ${process.env.SWARM_API_KEY}` } : {};

const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m` };

/* ---------------- 1. understand the request (keyword heuristic) ---------------- */
const categories = JSON.parse(readFileSync(`${root}vendors/categories.json`, "utf8"));
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function deadline(t) {
  if (/tomorrow/.test(t)) return { days: 1, label: "tomorrow" };
  const m = t.match(/in (\d+) days?/);
  if (m) return { days: Number(m[1]), label: `in ${m[1]} days` };
  const today = new Date().getDay();
  for (let i = 0; i < 7; i++)
    if (new RegExp(`\\b${DAYS[i]}\\b`).test(t)) return { days: (i - today + 7) % 7 || 7, label: DAYS[i][0].toUpperCase() + DAYS[i].slice(1) };
  if (/next week/.test(t)) return { days: 7, label: "next week" };
  return { days: null, label: null };
}
function intentFor(text) {
  const t = text.toLowerCase();
  const hits = categories
    .map((k) => ({ k, n: k.keywords.filter((w) => t.includes(w)).reduce((s, w) => s + w.length, 0) }))
    .sort((a, b) => b.n - a.n);
  const cat = hits[0].n ? hits[0].k : categories[0];
  const b = t.replace(/,/g, "").match(/(?:under|below|max(?:imum)?|budget(?: of)?|up to|less than)\s*£?\s?(\d{2,5})|£\s?(\d{2,5})/);
  const budget = b ? Number(b[1] ?? b[2]) : null;
  const d = deadline(t);
  return {
    category: cat.id,
    categoryLabel: cat.label,
    budget,
    deadlineDays: d.days,
    deadlineLabel: d.label,
    priorities: "best total value",
    summary: `${cat.label}${budget ? `, max £${budget}` : ""}${d.label ? `, delivered by ${d.label}` : ""}`,
  };
}

/* ---------------- 2. discover the swarm ---------------- */
const base = opt("base", "").replace(/\/$/, "");
const host = opt("host", "http://localhost");
async function cardUrls() {
  if (!base) {
    // Local swarm: one bot per port from vendor.json.
    const ids = JSON.parse(readFileSync(`${root}vendors/index.json`, "utf8"));
    return ids.map((id) => `${host}:${JSON.parse(readFileSync(`${root}vendors/${id}/vendor.json`, "utf8")).port}/card`);
  }
  // Deployed host: ask it which vendors it serves (the first call may wake a sleeping Render service).
  console.log(c.dim(`   discovering bots at ${base}/vendors …`));
  const r = await fetch(`${base}/vendors`, { signal: AbortSignal.timeout(90_000) });
  if (!r.ok) throw new Error(`${base}/vendors -> HTTP ${r.status}`);
  return (await r.json()).vendors.map((v) => v.cardUrl);
}

async function getCard(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(base ? 30_000 : 2000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function readNdjson(res, onEvent) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) > -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}

const score = (b, intent) =>
  b.price - b.perkValue + (intent.deadlineDays && b.deliveryDays > intent.deadlineDays ? LATE_PENALTY : 0) + (intent.budget && b.price > intent.budget ? 1000 : 0);

/* ---------------- 3. run it ---------------- */
const auctionId = randomUUID();
console.log(c.bold(`\n🔨 Haggle mini-auction ${c.dim(auctionId.slice(0, 8))}`));
console.log(`   "${request}"`);

const urls = await cardUrls();
const cards = (await Promise.all(urls.map(getCard))).filter(Boolean);
if (!cards.length) {
  console.error(c.red(`No bots answered (${urls.length} tried). ${base ? "Is the host up?" : "Start them with: npm run swarm"}`));
  process.exit(1);
}

// Catalogue check: the bots get the shopper's own words, say yes or no (with a reason),
// and hand back the intent they understood, which the /quote rounds then use.
const post = async (url, body) => {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    return r.ok ? await r.json() : { include: false, reason: `HTTP ${r.status}`, message: (await r.text()).slice(0, 120) };
  } catch (e) {
    return { include: false, reason: "unreachable", message: e.message };
  }
};
let intent = null;
let parser = "local rules";
let answers;
if (base) {
  // Deployed host: one call, the request is understood once and every vendor judged on it.
  const r = await post(`${base}/match`, { auctionId, request });
  if (!r.results) {
    console.error(c.red(`Catalogue check failed: ${r.reason ?? ""} ${r.message ?? ""}`));
    process.exit(1);
  }
  ({ intent, parser } = r);
  answers = cards.map((card) => ({ card, m: r.results.find((x) => x.merchantId === card.id) ?? { include: false, reason: "missing", message: "" } }));
} else {
  answers = await Promise.all(
    cards.map(async (card) =>
      card.endpoints.match
        ? { card, m: await post(card.endpoints.match, { auctionId, request }) }
        : { card, m: null }, // pre-1.2 bot: decide from its card below
    ),
  );
  const first = answers.find((a) => a.m?.intent);
  if (first) ({ intent, parser } = first.m);
}
intent ??= intentFor(request);
for (const a of answers) a.m ??= { include: a.card.categories.includes(intent.category), reason: "ok", message: "(no /match - pre-1.2 bot)" };
console.log(`   → ${c.cyan(intent.summary)} ${c.dim(`[${intent.category}${intent.budget ? `, £${intent.budget}` : ""}${intent.deadlineDays !== null ? `, ${intent.deadlineDays}d` : ""} · understood by ${parser}]`)}\n`);
const lots = answers.filter((a) => a.m.include).map(({ card, m }) => ({ card, match: m, status: "bidding", bid: null, lastMessage: "" }));
console.log(`   ${cards.length}/${urls.length} bots online · catalogue check: ${lots.length} in, ${answers.length - lots.length} out`);
for (const { card, m } of answers)
  console.log(
    m.include
      ? `     ${c.green("✓")} ${card.logo} ${card.name.padEnd(16)} ${m.product?.title ?? ""}${m.meetsDeadline === false ? c.yellow(" (late)") : ""} ${c.dim(fast ? "scripted (fast)" : card.engine)}`
      : c.dim(`     ✗ ${card.logo} ${card.name.padEnd(16)} ${m.reason}: ${m.message}`),
  );
console.log();
if (lots.length === 0) process.exit(0);

const board = () =>
  lots.map((l) => ({
    merchantId: l.card.id,
    name: l.card.name,
    status: l.status === "withdrawn" ? "withdrawn" : l.bid ? "bidding" : "no_bid",
    price: l.bid?.price ?? null,
    perks: l.bid?.perks ?? [],
    perkValue: l.bid?.perkValue ?? 0,
    deliveryDays: l.bid?.deliveryDays ?? null,
    score: l.bid ? score(l.bid, intent) : null,
  }));
const leaderLot = () =>
  lots.filter((l) => l.bid && l.status === "bidding").sort((a, b) => score(a.bid, intent) - score(b.bid, intent))[0] ?? null;

async function turn(lot, round) {
  const res = await fetch(lot.card.endpoints.quote, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({
      auctionId,
      round,
      rounds: ROUNDS,
      intent,
      fast,
      myBid: lot.bid ? { handle: lot.bid.handle, price: lot.bid.price, perkIds: lot.bid.perkIds } : null,
      leaderboard: board(),
    }),
  });
  if (!res.ok) {
    console.log(`   ${lot.card.logo} ${c.red(`HTTP ${res.status}`)} ${await res.text()}`);
    return;
  }
  const tag = `${lot.card.logo} ${lot.card.name.padEnd(16)}`;
  await readNdjson(res, (e) => {
    if (e.t === "guardrail") console.log(`   ${tag} ${c.red(`🛑 guardrail: ${e.message}`)}`);
    if (e.t === "tool" && e.name === "fallback") console.log(`   ${tag} ${c.yellow(`⚠ model fallback: ${e.result.reason}`)}`);
    else if (e.t === "tool" && e.name !== "get_pricing_policy") console.log(`   ${tag} ${c.dim(`↳ ${e.name}`)}`);
    if (e.t === "error") console.log(`   ${tag} ${c.red(e.message)}`);
    if (e.t === "decision") {
      const d = e.decision;
      if (d.action === "bid") {
        lot.bid = d;
        console.log(`   ${tag} ${c.green(`BID £${d.price}`)}${d.perks.length ? ` + ${d.perks.join(", ")}` : ""} ${c.dim(`(${d.deliveryDays}d, score ${d.score})`)}  “${d.message}”`);
      } else {
        if (d.action === "withdraw") lot.status = "withdrawn";
        console.log(`   ${tag} ${d.action === "hold" ? c.yellow("HOLD") : c.red("WITHDRAW")}  “${d.message}”`);
      }
    }
  });
}

for (let round = 1; round <= ROUNDS; round++) {
  console.log(c.bold(`── Round ${round}/${ROUNDS}${round === ROUNDS ? " (best and final)" : ""}`));
  // Challengers move in parallel; the current leader answers last.
  const lead = leaderLot();
  const active = lots.filter((l) => l.status === "bidding");
  await Promise.all(active.filter((l) => l !== lead).map((l) => turn(l, round)));
  if (lead && lead.status === "bidding") await turn(lead, round);
  const now = leaderLot();
  console.log(c.dim(`   leader: ${now ? `${now.card.name} at £${now.bid.price} (score ${score(now.bid, intent)})` : "nobody"}\n`));
}

const eligible = lots
  .filter((l) => l.bid && l.status === "bidding" && (!intent.budget || l.bid.price <= intent.budget))
  .sort((a, b) => score(a.bid, intent) - score(b.bid, intent));
if (!eligible.length) {
  console.log(c.red("No valid bids - the buyer walks away."));
  process.exit(0);
}
const [win, second] = eligible;
console.log(c.bold(`🏆 ${win.card.logo} ${win.card.name} wins: £${win.bid.price}${win.bid.perks.length ? ` + ${win.bid.perks.join(", ")}` : ""}, ${win.bid.deliveryDays}-day delivery`));
if (second) console.log(c.dim(`   runner-up ${second.card.name} £${second.bid.price}, ${score(second.bid, intent) - score(win.bid, intent)} worse on value`));

const res = await fetch(win.card.endpoints.award, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...auth },
  body: JSON.stringify({ auctionId, bid: { handle: win.bid.handle, price: win.bid.price, perkIds: win.bid.perkIds } }),
});
const deal = await res.json();
if (!res.ok) {
  console.log(c.red(`Award failed: ${deal.error}`));
  process.exit(1);
}
console.log(`\n🎟  ${c.bold(deal.code)}  ${deal.title}  £${deal.listTotal} → ${c.green(`£${deal.finalPrice}`)} ${deal.liveShopify ? c.green("[Shopify]") : c.dim("[mock]")}`);
console.log(`   ${deal.checkoutUrl}`);
console.log(c.dim(`   expires ${new Date(deal.expiresAt).toLocaleTimeString("en-GB")}\n`));
