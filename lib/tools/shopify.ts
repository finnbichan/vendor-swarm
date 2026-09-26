import { config } from "../config";

// Each vendor has its own dev store, so every call takes the store explicitly.
export type ShopifyStore = { domain: string; token: string };

export async function adminGql<T = unknown>(store: ShopifyStore, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${store.domain}/admin/api/${config.shopifyApiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": store.token },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 400));
  return json.data as T;
}

export type ShopifyProduct = {
  id: string;
  handle: string;
  title: string;
  description: string;
  image?: string;
  variantId: string;
  price: number;
  inventory: number | null;
};

export async function fetchShopifyProducts(store: ShopifyStore): Promise<ShopifyProduct[]> {
  const data = await adminGql<{
    products: {
      nodes: {
        id: string;
        handle: string;
        title: string;
        description: string;
        featuredImage: { url: string } | null;
        variants: { nodes: { id: string; price: string; inventoryQuantity: number | null }[] };
      }[];
    };
  }>(
    store,
    `{ products(first: 100, query: "status:active") { nodes { id handle title description featuredImage { url }
        variants(first: 1) { nodes { id price inventoryQuantity } } } } }`,
  );
  return data.products.nodes
    .filter((n) => n.variants.nodes[0])
    .map((n) => ({
      id: n.id,
      handle: n.handle,
      title: n.title,
      description: n.description,
      image: n.featuredImage?.url,
      variantId: n.variants.nodes[0].id,
      price: Number(n.variants.nodes[0].price),
      inventory: n.variants.nodes[0].inventoryQuantity,
    }));
}

const numericId = (gid: string) => gid.split("/").pop();

export function cartPermalink(store: ShopifyStore, variantIds: string[], code: string) {
  const items = variantIds.map((v) => `${numericId(v)}:1`).join(",");
  return `https://${store.domain}/cart/${items}?discount=${encodeURIComponent(code)}`;
}

export function makeCode(prefix = "HAGGLE") {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}-${s}`;
}

/** Real single-use Shopify discount code, limited to the negotiated products, expiring soon. */
export async function createDiscountCode(
  store: ShopifyStore,
  opts: { code: string; amountOff: number; productIds: string[]; ttlMinutes: number; title: string },
): Promise<{ id: string }> {
  const now = new Date();
  const ends = new Date(now.getTime() + opts.ttlMinutes * 60_000);
  const base = {
    title: opts.title,
    code: opts.code,
    startsAt: now.toISOString(),
    endsAt: ends.toISOString(),
    usageLimit: 1,
    appliesOncePerCustomer: true,
    customerGets: {
      value: { discountAmount: { amount: opts.amountOff.toFixed(2), appliesOnEachItem: false } },
      items: { products: { productsToAdd: opts.productIds } },
    },
  };
  const mutation = `mutation Create($d: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $d) { codeDiscountNode { id } userErrors { field message } } }`;
  type R = { discountCodeBasicCreate: { codeDiscountNode: { id: string } | null; userErrors: { message: string }[] } };

  // Newer API versions use `context`, older ones `customerSelection`. Try both.
  let lastErr = "";
  for (const who of [{ context: { all: "ALL" } }, { customerSelection: { all: true } }]) {
    try {
      const data = await adminGql<R>(store, mutation, { d: { ...base, ...who } });
      const r = data.discountCodeBasicCreate;
      if (r.codeDiscountNode) return { id: r.codeDiscountNode.id };
      lastErr = r.userErrors.map((e) => e.message).join("; ");
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  throw new Error(`Shopify discount failed: ${lastErr}`);
}
