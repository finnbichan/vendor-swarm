// /admin: the owner's configuration page and its API. The only place costs leave the bot,
// and only to a logged-in owner of this vendor.
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { z } from "zod";
import { llmTarget, providerStatus } from "../lib/config";
import { pingModel } from "../lib/llm";
import { parseStrategy } from "../lib/policy";
import { floorPrice } from "../lib/pricing";
import { authConfig, localLogin, requireOwner, type Owner } from "./auth";
import { storeFor } from "./award";
import { ConfigError, ConflictError, type VendorStore } from "./config-store";
import { policyOf, VendorSchema } from "./schema";

const ADMIN_DIR = new URL("./admin/", import.meta.url).pathname;

// Owners can edit everything except the wiring: id, port and which env vars hold Shopify creds.
const EditableVendor = VendorSchema.omit({ id: true, port: true, shopify: true }).partial();

type Env = { Variables: { owner: Owner } };

const page = (file: string, type: string) => async () =>
  new Response(await readFile(ADMIN_DIR + file, "utf8"), { headers: { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" } });
/** The admin HTML. Served at ".../admin/" (trailing slash) so its relative links resolve. */
export const adminPage = page("index.html", "text/html");

export function adminRoutes(store: VendorStore) {
  const vendorId = store.id;
  const app = new Hono<Env>();

  const configView = () => {
    const snap = store.current();
    const policy = policyOf(snap.vendor);
    const target = llmTarget(snap.vendor.llm);
    return {
      vendor: snap.vendor,
      catalog: snap.catalog,
      categories: snap.categories.map(({ id, label, emoji }) => ({ id, label, emoji })),
      floors: Object.fromEntries(snap.catalog.products.map((p) => [p.handle, floorPrice(p, policy)])),
      version: snap.version,
      providers: providerStatus(),
      status: {
        engine: target ? `${target.provider}:${target.model}` : "scripted",
        store: storeFor(snap.vendor) ? "shopify" : "mock",
        auth: authConfig().mode,
        storage: store.storage,
      },
    };
  };

  const fail = (e: unknown) => {
    if (e instanceof ConflictError) return { status: 409 as const, body: { error: e.message } };
    if (e instanceof ConfigError) return { status: 422 as const, body: { error: "Not saved - fix these first.", problems: e.problems } };
    if (e instanceof z.ZodError)
      return { status: 422 as const, body: { error: "Not saved - fix these first.", problems: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) } };
    throw e;
  };

  app.get("/app.js", page("app.js", "text/javascript"));

  app.get("/api/auth-config", (c) => {
    const v = store.current().vendor;
    return c.json({ vendorId, name: v.name, logo: v.logo, accent: v.accent, ...authConfig() });
  });

  app.post("/api/login", async (c) => {
    if (authConfig().mode !== "local") return c.json({ error: "This bot uses Supabase login." }, 400);
    const { password } = await c.req.json<{ password?: string }>().catch(() => ({ password: "" }));
    const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? "local";
    const r = localLogin(vendorId, String(password ?? ""), ip);
    return "error" in r ? c.json({ error: r.error }, r.status) : c.json(r);
  });

  const owner = new Hono<Env>();
  owner.use("*", requireOwner(vendorId));

  owner.get("/me", (c) => c.json(c.get("owner")));
  owner.get("/config", (c) => c.json(configView()));

  owner.put("/vendor", async (c) => {
    try {
      const patch = EditableVendor.parse(await c.req.json());
      await store.save({ vendor: { ...store.current().vendor, ...patch } }, c.get("owner").email);
      return c.json(configView());
    } catch (e) {
      const f = fail(e);
      return c.json(f.body, f.status);
    }
  });

  owner.post("/strategy", async (c) => {
    const body = z.object({ strategy: z.string().min(3).max(2000), apply: z.boolean().default(false) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Write a strategy first." }, 400);
    const v = store.current().vendor;
    const before = policyOf(v);
    try {
      const { policy, parser } = await parseStrategy(body.data.strategy, before, llmTarget(v.llm), vendorId);
      const diff = (["minMarginPct", "clearanceMarginPct", "perksFirst", "codeTtlMinutes"] as const)
        .filter((k) => policy[k] !== before[k])
        .map((k) => ({ field: k, from: before[k], to: policy[k] }));
      if (body.data.apply) await store.save({ vendor: { ...store.current().vendor, ...policy } }, c.get("owner").email);
      return c.json({ policy, parser, diff, applied: body.data.apply, config: body.data.apply ? configView() : undefined });
    } catch (e) {
      const f = fail(e);
      return c.json(f.body, f.status);
    }
  });

  owner.put("/catalog", async (c) => {
    try {
      await store.save({ catalog: await c.req.json() }, c.get("owner").email);
      return c.json(configView());
    } catch (e) {
      const f = fail(e);
      return c.json(f.body, f.status);
    }
  });

  // One tiny completion against the selected provider/model (unsaved selection allowed).
  owner.post("/llm-test", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const sel = z.object({ provider: z.string().optional(), model: z.string().max(120).optional() }).safeParse(body);
    const target = llmTarget(sel.success ? { ...store.current().vendor.llm, ...sel.data } : store.current().vendor.llm);
    if (!target) return c.json({ ok: false, error: "No API key configured on the server for that provider." }, 400);
    try {
      return c.json({ ...(await pingModel(target, vendorId)), provider: target.provider });
    } catch (e) {
      return c.json({ ok: false, provider: target.provider, model: target.model, error: (e as Error).message.slice(0, 300) }, 502);
    }
  });

  app.route("/api", owner);
  return app;
}
