// Pushes a vendor's catalog.json into that vendor's own Shopify dev store: creates/updates
// products by handle, sets price and unit cost, publishes to the Online Store.
// Usage: npm run seed -- --vendor aurora   |   npm run seed -- --all
// Vendors without <ID>_SHOPIFY_DOMAIN / <ID>_SHOPIFY_TOKEN are skipped (they run in mock mode).
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const version = process.env.SHOPIFY_API_VERSION || "2025-07";
const all = JSON.parse(readFileSync(`${root}vendors/index.json`, "utf8"));
const args = process.argv.slice(2);
const i = args.indexOf("--vendor");
const ids = args.includes("--all") ? all : i > -1 ? [args[i + 1]] : [];
if (!ids.length || ids.some((id) => !all.includes(id))) {
  console.error(`Usage: npm run seed -- --vendor <${all.join("|")}> | --all`);
  process.exit(1);
}

async function seedVendor(id) {
  const vendor = JSON.parse(readFileSync(`${root}vendors/${id}/vendor.json`, "utf8"));
  const { products } = JSON.parse(readFileSync(`${root}vendors/${id}/catalog.json`, "utf8"));
  const domain = process.env[vendor.shopify.domainEnv];
  const token = process.env[vendor.shopify.tokenEnv];
  if (!domain || !token) {
    console.log(`– ${id}: no ${vendor.shopify.domainEnv}/${vendor.shopify.tokenEnv}, skipping (mock mode)`);
    return;
  }
  const gql = async (query, variables) => {
    const res = await fetch(`https://${domain}/admin/api/${version}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data;
  };
  console.log(`▸ ${vendor.name} → ${domain}`);
  const pubs = await gql(`{ publications(first: 10) { nodes { id name } } }`).catch(() => null);
  const onlineStore = pubs?.publications.nodes.find((p) => /online store/i.test(p.name));

  for (const p of products) {
    const existing = await gql(`query($q: String!) { products(first: 1, query: $q) { nodes { id } } }`, { q: `handle:${p.handle}` });
    let pid = existing.products.nodes[0]?.id;
    const input = {
      title: p.title,
      handle: p.handle,
      descriptionHtml: `<p>${p.description}</p>`,
      tags: ["haggle", `category:${p.category}`, ...(p.clearance ? ["clearance"] : []), ...(p.hidden ? ["addon"] : [])],
      vendor: vendor.name,
      status: "ACTIVE",
    };
    if (!pid) {
      const r = await gql(`mutation($p: ProductCreateInput!) { productCreate(product: $p) { product { id } userErrors { field message } } }`, { p: input });
      if (r.productCreate.userErrors.length) throw new Error(JSON.stringify(r.productCreate.userErrors));
      pid = r.productCreate.product.id;
    } else {
      const r = await gql(`mutation($p: ProductUpdateInput!) { productUpdate(product: $p) { userErrors { field message } } }`, { p: { id: pid, ...input } });
      if (r.productUpdate.userErrors.length) console.warn("  ", p.handle, r.productUpdate.userErrors);
    }
    const v = await gql(`query($id: ID!) { product(id: $id) { variants(first: 1) { nodes { id } } } }`, { id: pid });
    const variantId = v.product.variants.nodes[0].id;
    const u = await gql(
      `mutation($pid: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $pid, variants: $v) { userErrors { field message } } }`,
      { pid, v: [{ id: variantId, price: String(p.price), inventoryPolicy: "CONTINUE", inventoryItem: { cost: String(p.cost), tracked: false } }] },
    );
    if (u.productVariantsBulkUpdate.userErrors.length) console.warn("  ", p.handle, u.productVariantsBulkUpdate.userErrors);
    if (onlineStore)
      await gql(`mutation($id: ID!, $p: [PublicationInput!]!) { publishablePublish(id: $id, input: $p) { userErrors { message } } }`, {
        id: pid,
        p: [{ publicationId: onlineStore.id }],
      }).catch((e) => console.warn("   publish failed", p.handle, e.message));
    console.log(`  ✓ ${p.handle} £${p.price}`);
  }
}

let failed = 0;
for (const id of ids) {
  try {
    await seedVendor(id);
  } catch (e) {
    failed++;
    console.error(`✗ ${id}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);
