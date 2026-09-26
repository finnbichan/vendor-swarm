// Owner login for /admin. Supabase Auth when configured; otherwise a per-vendor local password
// so the swarm still runs keyless. Either way the caller must own *this* bot's vendor id.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MiddlewareHandler } from "hono";
import { config, live } from "../lib/config";

export type Owner = { email: string; mode: "supabase" | "local" };

const SECRET = process.env.ADMIN_SESSION_SECRET || randomBytes(32).toString("hex");
const SESSION_HOURS = 12;

export const envPrefix = (vendorId: string) => vendorId.toUpperCase().replace(/-/g, "_");
export const localPassword = (vendorId: string) => process.env[`${envPrefix(vendorId)}_ADMIN_PASSWORD`] || `haggle-${vendorId}`;

export function authConfig() {
  return live.supabaseAuth()
    ? { mode: "supabase" as const, url: config.supabase.url, anonKey: config.supabase.anonKey }
    : { mode: "local" as const };
}

/* ---------------- local mode: HMAC-signed session token ---------------- */
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("base64url");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const attempts = new Map<string, { n: number; at: number }>();

export function localLogin(vendorId: string, password: string, ip: string): { token: string; expiresAt: number } | { error: string; status: 401 | 429 } {
  const key = `${vendorId}:${ip}`; // one process may host several vendors
  const a = attempts.get(key);
  if (a && Date.now() - a.at < 60_000 && a.n >= 5) return { error: "Too many attempts - wait a minute.", status: 429 };
  if (!safeEqual(password, localPassword(vendorId))) {
    attempts.set(key, { n: a && Date.now() - a.at < 60_000 ? a.n + 1 : 1, at: a && Date.now() - a.at < 60_000 ? a.at : Date.now() });
    return { error: "Wrong password.", status: 401 };
  }
  attempts.delete(key);
  const expiresAt = Date.now() + SESSION_HOURS * 3_600_000;
  const body = b64(JSON.stringify({ sub: vendorId, exp: expiresAt }));
  return { token: `local.${body}.${sign(body)}`, expiresAt };
}

function verifyLocal(vendorId: string, token: string): Owner | null {
  const [kind, body, sig] = token.split(".");
  if (kind !== "local" || !body || !sig || !safeEqual(sig, sign(body))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { sub: string; exp: number };
    return p.sub === vendorId && p.exp > Date.now() ? { email: `${vendorId} (local)`, mode: "local" } : null;
  } catch {
    return null;
  }
}

/* ---------------- supabase mode ---------------- */
let sb: SupabaseClient | null = null;
const supa = () => (sb ??= createClient(config.supabase.url, config.supabase.anonKey, { auth: { persistSession: false, autoRefreshToken: false } }));

async function verifySupabase(vendorId: string, token: string): Promise<Owner | "forbidden" | null> {
  const { data, error } = await supa().auth.getUser(token);
  if (error || !data.user) return null;
  // app_metadata is only writable with the service-role key, so users can't grant themselves a vendor.
  if (data.user.app_metadata?.vendor_id !== vendorId) return "forbidden";
  return { email: data.user.email ?? data.user.id, mode: "supabase" };
}

/* ---------------- middleware ---------------- */
export function requireOwner(vendorId: string): MiddlewareHandler<{ Variables: { owner: Owner } }> {
  return async (c, next) => {
    const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return c.json({ error: "Log in first." }, 401);
    const owner = token.startsWith("local.")
      ? live.supabaseAuth()
        ? null // local tokens aren't accepted once Supabase Auth is configured
        : verifyLocal(vendorId, token)
      : live.supabaseAuth()
        ? await verifySupabase(vendorId, token)
        : null;
    if (owner === "forbidden") return c.json({ error: "That account doesn't manage this vendor." }, 403);
    if (!owner) return c.json({ error: "Session expired or invalid - log in again." }, 401);
    c.set("owner", owner);
    await next();
  };
}

/** Non-failing variant: tells a public route whether the caller happens to be the owner. */
export async function isOwner(vendorId: string, authHeader: string | undefined) {
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  if (token.startsWith("local.")) return !live.supabaseAuth() && !!verifyLocal(vendorId, token);
  if (!live.supabaseAuth()) return false;
  const r = await verifySupabase(vendorId, token).catch(() => null);
  return !!r && r !== "forbidden";
}
