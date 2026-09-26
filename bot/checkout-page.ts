import type { Vendor } from "./schema";

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const gbp = (n: number) => `£${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;

/** Stand-in checkout for vendors without a Shopify store: shows the negotiated deal. */
export function mockCheckoutPage(v: Vendor, q: URLSearchParams) {
  const price = Number(q.get("price") ?? 0);
  const list = Number(q.get("list") ?? price);
  const exp = Number(q.get("exp") ?? 0);
  const perks = (q.get("perks") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(v.name)} checkout</title>
<style>
:root{--bg:#f6f5f2;--card:#fff;--ink:#18181b;--muted:#71717a;--line:#e4e4e7;--accent:${esc(v.accent)}}
@media (prefers-color-scheme:dark){:root{--bg:#0f0f11;--card:#18181b;--ink:#f4f4f5;--muted:#a1a1aa;--line:#27272a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;max-width:420px;width:100%;padding:24px}
.brand{font-weight:600;display:flex;gap:8px;align-items:center}.muted{color:var(--muted);font-size:13px}
.row{display:flex;justify-content:space-between;padding:6px 0}.total{font-size:22px;font-weight:700;border-top:1px solid var(--line);margin-top:8px;padding-top:12px}
.code{font-family:ui-monospace,monospace;background:var(--bg);border:1px dashed var(--accent);border-radius:8px;padding:8px 12px;display:inline-block;margin:12px 0}
button{width:100%;margin-top:16px;padding:12px;border:0;border-radius:10px;background:var(--accent);color:#fff;font-weight:600;font-size:15px;cursor:pointer}
</style></head><body><main class="card">
<div class="brand"><span>${esc(v.logo)}</span>${esc(v.name)}</div>
<p class="muted">Mock checkout: this vendor isn't connected to a Shopify store.</p>
<h2 style="margin:12px 0 4px">${esc(q.get("title") ?? "Your item")}</h2>
${perks.length ? `<p class="muted">Includes: ${perks.map(esc).join(", ")}</p>` : ""}
<div class="code">${esc(q.get("code") ?? "")}</div>
<div class="row"><span>List price</span><span>${gbp(list)}</span></div>
<div class="row"><span>Haggle discount</span><span>−${gbp(Math.max(0, list - price))}</span></div>
<div class="row total"><span>Total</span><span>${gbp(price)}</span></div>
${exp ? `<p class="muted">Code expires ${new Date(exp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.</p>` : ""}
<button onclick="this.textContent='Order placed (mock) ✓';this.disabled=true">Pay ${gbp(price)}</button>
</main></body></html>`;
}
