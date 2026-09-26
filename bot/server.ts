// One vendor bot per process (the local swarm). Usage: tsx bot/server.ts --vendor <id>
import { serve } from "@hono/node-server";
import { live } from "../lib/config";
import { createVendorApp, engineOf } from "./app";
import { authConfig } from "./auth";
import { storeFor } from "./award";
import { VendorStore } from "./config-store";
import { perksFor } from "./merchant";
import { assertProductionReady } from "./prod-checks";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const vendorId = arg("vendor") ?? process.env.VENDOR;
if (!vendorId) {
  console.error("Usage: tsx bot/server.ts --vendor <id>");
  process.exit(1);
}
assertProductionReady([vendorId]);

const log = (msg: string) => console.log(`[${vendorId}] ${msg}`);
const store = await VendorStore.open(vendorId, log);
const boot = store.current();
const port = Number(process.env.PORT || boot.vendor.port);
const publicUrl = (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, "");
const app = createVendorApp(store, { publicUrl, log });

serve({ fetch: app.fetch, port }, () => {
  const v = boot.vendor;
  const cats = [...new Set(boot.catalog.products.filter((p) => !p.hidden).map((p) => p.category))];
  const perkCount = new Set(cats.flatMap((k) => perksFor(boot, k).map((p) => p.id))).size;
  log(
    `${v.logo} ${v.name} on ${publicUrl}  ·  ${cats.join(", ")}  ·  ${perkCount} perks  ·  ` +
      `${engineOf(store)} / ${storeFor(v) ? "shopify" : "mock store"} / ${authConfig().mode} auth / ${store.storage} config` +
      (live.tavily() ? " / tavily" : ""),
  );
});
