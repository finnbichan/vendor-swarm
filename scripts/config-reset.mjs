// Overwrite a vendor's Supabase config row with the repo JSON (demo reset). Keeps history.
// Usage: npm run config:reset -- --vendor aurora | --all
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const root = new URL("..", import.meta.url).pathname;
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. (Without Supabase the bots read vendors/*.json directly - nothing to reset.)");
  process.exit(1);
}
const all = JSON.parse(readFileSync(`${root}vendors/index.json`, "utf8"));
const args = process.argv.slice(2);
const i = args.indexOf("--vendor");
const ids = args.includes("--all") ? all : i > -1 ? [args[i + 1]] : [];
if (!ids.length || ids.some((id) => !all.includes(id))) {
  console.error(`Usage: npm run config:reset -- --vendor <${all.join("|")}> | --all`);
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let failed = 0;
for (const id of ids) {
  const vendor = JSON.parse(readFileSync(`${root}vendors/${id}/vendor.json`, "utf8"));
  const catalog = JSON.parse(readFileSync(`${root}vendors/${id}/catalog.json`, "utf8"));
  const { data: row, error: e1 } = await sb.from("vendor_config").select("version").eq("vendor_id", id).maybeSingle();
  if (e1) {
    console.error(`✗ ${id}: ${e1.message}`);
    failed++;
    continue;
  }
  const version = (row?.version ?? 0) + 1;
  const { error } = row
    ? await sb.from("vendor_config").update({ vendor, catalog, version, updated_by: "config:reset", updated_at: new Date().toISOString() }).eq("vendor_id", id)
    : await sb.from("vendor_config").insert({ vendor_id: id, vendor, catalog, version, updated_by: "config:reset" });
  if (error) {
    console.error(`✗ ${id}: ${error.message}`);
    failed++;
    continue;
  }
  await sb.from("vendor_config_history").insert({ vendor_id: id, version, vendor, catalog, updated_by: "config:reset" });
  console.log(`✓ ${id} reset to repo JSON (v${version}) - running bots pick it up via realtime within seconds`);
}
process.exit(failed ? 1 : 0);
