// Supabase backend for VendorStore: one row per vendor in `vendor_config`, every save
// appended to `vendor_config_history`. Uses the service-role key, server-side only; the
// tables have RLS on with no policies, so the anon key can't read costs.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../lib/config";
import { ConflictError, seedFiles, type Backend, type Raw } from "./config-store";
import type { Catalog, Vendor } from "./schema";

let sb: SupabaseClient | null = null;
export const serviceClient = () =>
  (sb ??= createClient(config.supabase.url, config.supabase.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }));

type Row = { vendor_id: string; vendor: unknown; catalog: unknown; version: number };
const POLL_MS = 30_000;

export class SupabaseBackend implements Backend {
  kind = "supabase" as const;
  constructor(
    private id: string,
    private log: (msg: string) => void,
  ) {}

  private async fetch(): Promise<Row | null> {
    const { data, error } = await serviceClient().from("vendor_config").select("vendor_id,vendor,catalog,version").eq("vendor_id", this.id).maybeSingle();
    if (error) throw new Error(`Supabase load failed for ${this.id}: ${error.message} (did you run supabase/migrations/001_vendor_config.sql?)`);
    return data as Row | null;
  }

  async load(): Promise<Raw> {
    let row = await this.fetch();
    if (!row) {
      // First boot: seed from the repo JSON.
      const seed = seedFiles(this.id);
      const { error } = await serviceClient().from("vendor_config").insert({ vendor_id: this.id, ...seed, version: 1, updated_by: "seed" });
      if (error && error.code !== "23505") throw new Error(`Supabase seed failed for ${this.id}: ${error.message}`);
      if (!error) {
        await serviceClient().from("vendor_config_history").insert({ vendor_id: this.id, version: 1, ...seed, updated_by: "seed" });
        this.log("seeded config into Supabase from repo JSON");
      }
      row = await this.fetch();
      if (!row) throw new Error(`Supabase seed for ${this.id} did not persist`);
    }
    return { vendor: row.vendor, catalog: row.catalog, version: row.version };
  }

  async save(next: { vendor: Vendor; catalog: Catalog }, expected: number, by: string): Promise<number> {
    const version = expected + 1;
    // Optimistic concurrency: only update if nobody else bumped the version first.
    const { data, error } = await serviceClient()
      .from("vendor_config")
      .update({ ...next, version, updated_by: by, updated_at: new Date().toISOString() })
      .eq("vendor_id", this.id)
      .eq("version", expected)
      .select("version");
    if (error) throw new Error(`Supabase save failed: ${error.message}`);
    if (!data?.length) throw new ConflictError();
    const h = await serviceClient().from("vendor_config_history").insert({ vendor_id: this.id, version, ...next, updated_by: by });
    if (h.error) this.log(`history insert failed: ${h.error.message}`);
    return version;
  }

  watch(onChange: (raw: Raw) => void) {
    const push = (row: Row) => onChange({ vendor: row.vendor, catalog: row.catalog, version: row.version });
    serviceClient()
      .channel(`vendor_config:${this.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "vendor_config", filter: `vendor_id=eq.${this.id}` }, (p) => push(p.new as Row))
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") this.log(`realtime ${status.toLowerCase()}, relying on ${POLL_MS / 1000}s polling`);
      });
    // Backup for missed realtime events (sleeping dyno, network blips).
    setInterval(() => {
      this.fetch()
        .then((row) => row && push(row))
        .catch((e) => this.log(`poll failed: ${(e as Error).message}`));
    }, POLL_MS).unref();
  }
}
