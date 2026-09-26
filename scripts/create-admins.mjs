// Creates (or updates) one Supabase Auth user per vendor, tagged with app_metadata.vendor_id
// so it can only manage that vendor's bot. Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
// Usage: npm run admins -- --vendor aurora | --all
// Email: <id>@<ADMIN_EMAIL_DOMAIN (default haggle.dev)>. Password: <ID>_ADMIN_PASSWORD or generated.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const root = new URL("..", import.meta.url).pathname;
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env (the bots only need SUPABASE_ANON_KEY).");
  process.exit(1);
}
const all = JSON.parse(readFileSync(`${root}vendors/index.json`, "utf8"));
const args = process.argv.slice(2);
const i = args.indexOf("--vendor");
const ids = args.includes("--all") ? all : i > -1 ? [args[i + 1]] : [];
if (!ids.length || ids.some((id) => !all.includes(id))) {
  console.error(`Usage: npm run admins -- --vendor <${all.join("|")}> | --all`);
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const domain = process.env.ADMIN_EMAIL_DOMAIN || "haggle.dev";
const existing = new Map();
for (let page = 1; ; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  for (const u of data.users) if (u.email) existing.set(u.email, u);
  if (data.users.length < 200) break;
}

for (const id of ids) {
  const email = `${id}@${domain}`;
  const password = process.env[`${id.toUpperCase().replace(/-/g, "_")}_ADMIN_PASSWORD`] || randomBytes(9).toString("base64url");
  const attrs = { password, email_confirm: true, app_metadata: { vendor_id: id } };
  const found = existing.get(email);
  const { error } = found ? await sb.auth.admin.updateUserById(found.id, attrs) : await sb.auth.admin.createUser({ email, ...attrs });
  if (error) console.error(`✗ ${id}: ${error.message}`);
  else console.log(`✓ ${id.padEnd(11)} ${email.padEnd(24)} ${password}   (${found ? "updated" : "created"})`);
}
