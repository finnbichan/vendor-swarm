// Vendor admin page. Plain ES module, no build step.
const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} },
};

let auth = null; // { mode, url, anonKey, vendorId, name, logo, accent }
let sb = null; // supabase client (supabase mode)
let cfg = null; // last /admin/api/config

/* ---------------- auth ---------------- */
async function token() {
  if (auth.mode === "supabase") return (await sb.auth.getSession()).data.session?.access_token ?? null;
  return store.get(`haggle-admin-${auth.vendorId}`);
}

async function api(path, opts = {}) {
  const t = await token();
  const res = await fetch(`api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(opts.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) { showLogin(body.error); throw new Error(body.error); }
  if (!res.ok) { const e = new Error(body.error || `HTTP ${res.status}`); e.problems = body.problems; throw e; }
  return body;
}

function showLogin(err) {
  $("app").classList.add("hidden");
  $("login").classList.remove("hidden");
  $("login-error").textContent = err && err !== "Log in first." ? err : "";
}

async function logout() {
  if (auth.mode === "supabase") await sb.auth.signOut();
  store.set(`haggle-admin-${auth.vendorId}`, null);
  showLogin();
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("login-error").textContent = "";
  const password = $("password").value;
  try {
    if (auth.mode === "supabase") {
      const { error } = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password });
      if (error) throw error;
    } else {
      const res = await fetch("api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      store.set(`haggle-admin-${auth.vendorId}`, body.token);
    }
    $("password").value = "";
    await boot();
  } catch (err) {
    $("login-error").textContent = err.message || "Login failed.";
  }
});
$("logout").addEventListener("click", logout);

/* ---------------- tabs ---------------- */
document.querySelectorAll(".tab").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    document.querySelectorAll("[data-panel]").forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== b.dataset.tab));
    store.set("haggle-admin-tab", b.dataset.tab);
    clearMsg();
  }),
);

/* ---------------- messages ---------------- */
function clearMsg() { $("msg").innerHTML = ""; }
function say(kind, text, problems) {
  const div = document.createElement("div");
  div.className = `banner ${kind}`;
  div.textContent = text;
  if (problems?.length) {
    const ul = document.createElement("ul");
    for (const p of problems) { const li = document.createElement("li"); li.textContent = p; ul.appendChild(li); }
    div.appendChild(ul);
  }
  $("msg").replaceChildren(div);
  div.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
async function saving(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { say("bad", e.message, e.problems); } finally { btn.disabled = false; }
}

/* ---------------- DOM helpers ---------------- */
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "on") for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
    else if (k === "value" || (k in n && typeof v !== "string")) n[k] = v;
    else n.setAttribute(k, v);
  }
  for (const k of kids) n.append(k);
  return n;
}
const num = (v) => (v === "" || v == null ? undefined : Number(v));
const td = (...kids) => el("td", {}, ...kids);
const input = (type, value, extra = {}) => el("input", { type, value: value ?? "", ...extra });

/* ---------------- Rules ---------------- */
function perkRow(p = { id: "", label: "", costToMerchant: 0, valueToBuyer: 0 }) {
  const tr = el("tr");
  tr.append(
    td(input("text", p.id, { "data-k": "id", placeholder: "free-case" })),
    td(input("text", p.label, { "data-k": "label", placeholder: "Free carry case" })),
    el("td", { class: "num" }, input("number", p.costToMerchant, { "data-k": "costToMerchant", min: "0" })),
    el("td", { class: "num" }, input("number", p.valueToBuyer, { "data-k": "valueToBuyer", min: "0" })),
    el("td", { class: "num" }, input("number", p.deliveryDays ?? "", { "data-k": "deliveryDays", min: "0", placeholder: "-" })),
    td(input("text", (p.categories ?? []).join(", "), { "data-k": "categories", placeholder: "all" })),
    td(input("text", p.addonHandle ?? "", { "data-k": "addonHandle", placeholder: "-" })),
    td(el("button", { class: "btn danger", type: "button", on: { click: () => tr.remove() } }, "Remove")),
  );
  return tr;
}
function readPerks() {
  return [...$("perks").rows].map((tr) => {
    const v = (k) => tr.querySelector(`[data-k=${k}]`).value.trim();
    const cats = v("categories").split(",").map((s) => s.trim()).filter(Boolean);
    return {
      id: v("id"), label: v("label"), costToMerchant: Number(v("costToMerchant") || 0), valueToBuyer: Number(v("valueToBuyer") || 0),
      ...(v("deliveryDays") !== "" ? { deliveryDays: Number(v("deliveryDays")) } : {}),
      ...(cats.length ? { categories: cats } : {}),
      ...(v("addonHandle") ? { addonHandle: v("addonHandle") } : {}),
    };
  });
}
function fillRules(v) {
  $("strategy").value = v.strategy;
  for (const k of ["minMarginPct", "clearanceMarginPct", "codeTtlMinutes", "deliveryDays"]) $(k).value = v[k];
  $("perksFirst").checked = v.perksFirst;
  $("openingDiscountPct").value = v.scripted.openingDiscountPct;
  $("undercut").value = v.scripted.undercut;
  $("perks").replaceChildren(...v.perks.map(perkRow));
  $("parse-out").textContent = "";
  fillModel(v);
}

/* ---------------- Model ---------------- */
function fillModel(v) {
  const sel = $("llm-provider");
  sel.replaceChildren(
    el("option", { value: "" }, "Server default"),
    ...cfg.providers.map((p) => el("option", { value: p.id }, `${p.id}${p.configured ? "" : " (no key on server)"}`)),
  );
  sel.value = v.llm?.provider ?? "";
  $("llm-model").value = v.llm?.model ?? "";
  modelPlaceholder();
  $("llm-out").textContent = `Now: ${cfg.status.engine}`;
}
function modelPlaceholder() {
  const p = cfg.providers.find((x) => x.id === $("llm-provider").value);
  $("llm-model").placeholder = p ? p.defaultModel || "model id" : "server default";
}
const readModel = () => {
  const provider = $("llm-provider").value;
  const model = $("llm-model").value.trim();
  return { ...(provider ? { provider } : {}), ...(model ? { model } : {}) };
};
$("llm-provider").addEventListener("change", modelPlaceholder);
$("llm-test").addEventListener("click", (e) =>
  saving(e.target, async () => {
    $("llm-out").textContent = "Calling…";
    try {
      const r = await api("/llm-test", { method: "POST", body: JSON.stringify(readModel()) });
      $("llm-out").textContent = `✓ ${r.provider}:${r.model} answered "${r.reply}" in ${(r.ms / 1000).toFixed(1)}s`;
    } catch (err) {
      $("llm-out").textContent = "";
      throw err;
    }
  }),
);
$("add-perk").addEventListener("click", () => $("perks").append(perkRow()));
for (const k of ["minMarginPct", "clearanceMarginPct"]) $(k).addEventListener("input", renderFloors);

$("parse").addEventListener("click", (e) =>
  saving(e.target, async () => {
    const r = await api("/strategy", { method: "POST", body: JSON.stringify({ strategy: $("strategy").value, apply: false }) });
    for (const k of ["minMarginPct", "clearanceMarginPct", "codeTtlMinutes"]) $(k).value = r.policy[k];
    $("perksFirst").checked = r.policy.perksFirst;
    $("parse-out").textContent = r.diff.length
      ? `Read by ${r.parser === "grok" ? "Grok" : "rules"}: ${r.diff.map((d) => `${d.field} ${d.from} → ${d.to}`).join(", ")}. Review, then save.`
      : `Read by ${r.parser === "grok" ? "Grok" : "rules"}: no numbers changed.`;
    renderFloors();
  }),
);

$("save-rules").addEventListener("click", (e) =>
  saving(e.target, async () => {
    cfg = await api("/vendor", {
      method: "PUT",
      body: JSON.stringify({
        strategy: $("strategy").value,
        minMarginPct: num($("minMarginPct").value),
        clearanceMarginPct: num($("clearanceMarginPct").value),
        codeTtlMinutes: num($("codeTtlMinutes").value),
        deliveryDays: num($("deliveryDays").value),
        perksFirst: $("perksFirst").checked,
        scripted: { openingDiscountPct: num($("openingDiscountPct").value), undercut: num($("undercut").value) },
        perks: readPerks(),
        llm: readModel(),
      }),
    });
    render();
    say("ok", "Rules saved. Your agent uses them from its next bid.");
  }),
);

/* ---------------- Catalogue ---------------- */
function floorFor(p) {
  const m = Number((p.clearance ? $("clearanceMarginPct") : $("minMarginPct")).value || 0) / 100;
  return m >= 1 ? Infinity : Math.ceil(Number(p.cost || 0) / (1 - m));
}
const competitorsText = (list) => (list ?? []).map((c) => `${c.store}, ${c.price}, ${c.url}`).join("\n");
const parseCompetitors = (text) =>
  text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const [store, price, ...url] = l.split(",").map((s) => s.trim());
    return { store, price: Number(price), url: url.join(",") || "" };
  });

function productRows(p) {
  const main = el("tr", { "data-product": "" });
  const details = el("tr", { class: "details hidden" });
  const catSel = el("select", { "data-k": "category" }, ...cfg.categories.map((c) => el("option", { value: c.id, selected: c.id === p.category }, `${c.emoji} ${c.label}`)));
  const floorCell = el("td", { class: "floor" });
  main.append(
    td(input("text", p.title, { "data-k": "title" })),
    td(catSel),
    el("td", { class: "num" }, input("number", p.price, { "data-k": "price", min: "0", step: "1" })),
    el("td", { class: "num" }, input("number", p.cost, { "data-k": "cost", min: "0", step: "1" })),
    el("td", { class: "num" }, input("number", p.stock, { "data-k": "stock", min: "0", step: "1" })),
    td(input("checkbox", "", { "data-k": "clearance", checked: !!p.clearance })),
    td(input("checkbox", "", { "data-k": "hidden", checked: !!p.hidden })),
    floorCell,
    td(
      el("div", { class: "row", style: "flex-wrap:nowrap" },
        el("button", { class: "btn", type: "button", on: { click: () => details.classList.toggle("hidden") } }, "More"),
        el("button", { class: "btn danger", type: "button", on: { click: () => { main.remove(); details.remove(); } } }, "Delete"),
      ),
    ),
  );
  details.append(
    el("td", { colspan: "9" },
      el("div", { class: "grid" },
        el("label", { class: "field" }, el("span", {}, "Handle (matches Shopify)"), input("text", p.handle, { "data-k": "handle", placeholder: "my-product" })),
        el("label", { class: "field" }, el("span", {}, "Emoji"), input("text", p.emoji, { "data-k": "emoji" })),
        el("label", { class: "field" }, el("span", {}, "Image URL"), input("text", p.image ?? "", { "data-k": "image" })),
        el("label", { class: "field" }, el("span", {}, "Competitor search query"), input("text", p.comparatorQuery, { "data-k": "comparatorQuery" })),
      ),
      el("div", { class: "grid", style: "margin-top:10px" },
        el("label", { class: "field" }, el("span", {}, "Description"), el("textarea", { "data-k": "description", rows: 3, value: p.description ?? "" })),
        el("label", { class: "field" }, el("span", {}, "Mock competitor prices (store, price, url per line)"), el("textarea", { "data-k": "mockCompetitors", rows: 3, value: competitorsText(p.mockCompetitors) })),
      ),
    ),
  );
  main._details = details;
  main._floor = floorCell;
  main.addEventListener("input", renderFloors);
  return [main, details];
}

function readProduct(main) {
  const q = (k) => main.querySelector(`[data-k=${k}]`) ?? main._details.querySelector(`[data-k=${k}]`);
  const image = q("image").value.trim();
  return {
    handle: q("handle").value.trim(),
    category: q("category").value,
    title: q("title").value.trim(),
    description: q("description").value.trim(),
    price: Number(q("price").value),
    cost: Number(q("cost").value),
    stock: Number(q("stock").value),
    emoji: q("emoji").value.trim() || "📦",
    comparatorQuery: q("comparatorQuery").value.trim(),
    mockCompetitors: parseCompetitors(q("mockCompetitors").value),
    ...(q("clearance").checked ? { clearance: true } : {}),
    ...(q("hidden").checked ? { hidden: true } : {}),
    ...(image ? { image } : {}),
  };
}
const productMains = () => [...$("products").querySelectorAll("tr[data-product]")];

function renderFloors() {
  for (const tr of productMains()) {
    const p = readProduct(tr);
    const f = floorFor(p);
    const margin = p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : 0;
    tr._floor.textContent = "";
    tr._floor.append(
      el("span", { class: p.hidden ? "muted" : p.price >= f ? "ok" : "bad" }, Number.isFinite(f) ? `£${f}` : "-"),
      el("span", { class: "muted" }, ` · ${margin}% at list`),
    );
  }
}

$("add-product").addEventListener("click", () => {
  const cat = cfg.categories[0].id;
  const [a, b] = productRows({ handle: `${auth.vendorId}-new-${Date.now().toString(36)}`, category: cat, title: "", description: "", price: 0, cost: 0, stock: 0, emoji: "📦", comparatorQuery: "", mockCompetitors: [] });
  $("products").append(a, b);
  b.classList.remove("hidden");
  a.querySelector("[data-k=title]").focus();
  renderFloors();
});

$("save-catalog").addEventListener("click", (e) =>
  saving(e.target, async () => {
    cfg = await api("/catalog", { method: "PUT", body: JSON.stringify({ products: productMains().map(readProduct) }) });
    render();
    say("ok", `Catalogue saved (${cfg.catalog.products.length} products).`);
  }),
);

/* ---------------- Voice ---------------- */
function fillVoice(v) {
  for (const k of ["name", "tagline", "logo", "accent", "personality"]) $(k).value = v[k];
  for (const k of ["opening", "counter", "hold", "withdraw"]) $(`v-${k}`).value = v.voice[k];
}
$("save-voice").addEventListener("click", (e) =>
  saving(e.target, async () => {
    const body = Object.fromEntries(["name", "tagline", "logo", "accent", "personality"].map((k) => [k, $(k).value.trim()]));
    body.voice = Object.fromEntries(["opening", "counter", "hold", "withdraw"].map((k) => [k, $(`v-${k}`).value.trim()]));
    cfg = await api("/vendor", { method: "PUT", body: JSON.stringify(body) });
    render();
    say("ok", "Persona saved.");
  }),
);

/* ---------------- render ---------------- */
function brand(v) {
  document.documentElement.style.setProperty("--accent", v.accent);
  document.title = `${v.name} Admin`;
  $("h-logo").textContent = v.logo;
  $("h-name").textContent = v.name;
  $("h-tagline").textContent = `${v.tagline} · port ${v.port}`;
}
function render() {
  const v = cfg.vendor;
  brand(v);
  const s = cfg.status;
  $("s-engine").textContent = s.engine === "scripted" ? "Scripted negotiator" : s.engine;
  $("s-engine-dot").classList.toggle("on", s.engine !== "scripted");
  $("s-store").textContent = s.store === "shopify" ? "Shopify store" : "Mock store";
  $("s-store-dot").classList.toggle("on", s.store === "shopify");
  $("s-auth").textContent = `${s.auth === "supabase" ? "Supabase login" : "Local login"} · ${s.storage === "supabase" ? "Supabase config" : "file config"}`;
  $("shopify-note").textContent = s.store === "shopify" ? `Prices shown to buyers come from here. Run "npm run seed -- --vendor ${v.id}" to push new products to Shopify.` : "";
  fillRules(v);
  fillVoice(v);
  $("products").replaceChildren(...cfg.catalog.products.flatMap(productRows));
  renderFloors();
}

async function boot() {
  cfg = await api("/config");
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  render();
  const tab = store.get("haggle-admin-tab");
  if (tab) document.querySelector(`.tab[data-tab="${tab}"]`)?.click();
}

async function start() {
  auth = await fetch("api/auth-config").then((r) => r.json());
  document.documentElement.style.setProperty("--accent", auth.accent);
  $("l-logo").textContent = auth.logo;
  $("l-name").textContent = auth.name;
  document.title = `${auth.name} Admin`;
  if (auth.mode === "supabase") {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    sb = createClient(auth.url, auth.anonKey, { auth: { storageKey: `haggle-sb-${auth.vendorId}` } });
    $("login-hint").textContent = `Log in with the account that manages ${auth.name}.`;
  } else {
    $("email-field").classList.add("hidden");
    $("login-hint").textContent = `Local login (Supabase not configured). Password comes from ${auth.vendorId.toUpperCase().replace(/-/g, "_")}_ADMIN_PASSWORD.`;
  }
  if (await token()) boot().catch(() => {});
  else showLogin();
}
start();
