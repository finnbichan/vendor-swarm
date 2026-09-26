// POST /award: the auctioneer picked us. Re-check the bid against our own guardrail, then
// issue a single-use discount code in our Shopify store (or a mock one) for the agreed price.
import type { AwardRequest, AwardResponse } from "../protocol";
import { floorPrice, marginPct } from "../lib/pricing";
import { cartPermalink, createDiscountCode, fetchShopifyProducts, makeCode, type ShopifyProduct, type ShopifyStore } from "../lib/tools/shopify";
import type { Snapshot } from "./config-store";
import { perksFor } from "./merchant";
import { policyOf, type Product, type Vendor } from "./schema";

export class AwardError extends Error {
  constructor(message: string, public status = 422) {
    super(message);
  }
}

export function storeFor(v: Vendor): ShopifyStore | null {
  const domain = process.env[v.shopify.domainEnv];
  const token = process.env[v.shopify.tokenEnv];
  return domain && token ? { domain, token } : null;
}

// Keyed by store domain: one process may host several vendors, each with its own store.
const remote = new Map<string, { at: number; byHandle: Map<string, ShopifyProduct> }>();
async function shopifyProducts(store: ShopifyStore) {
  const hit = remote.get(store.domain);
  if (hit && Date.now() - hit.at < 60_000) return hit.byHandle;
  const byHandle = new Map((await fetchShopifyProducts(store)).map((p) => [p.handle, p]));
  remote.set(store.domain, { at: Date.now(), byHandle });
  return byHandle;
}

export async function award(snap: Snapshot, req: AwardRequest, publicUrl: string): Promise<AwardResponse> {
  const v = snap.vendor;
  const policy = policyOf(v);
  const product = snap.catalog.products.find((p) => p.handle === req.bid.handle && !p.hidden);
  if (!product) throw new AwardError(`Unknown product ${req.bid.handle}`, 404);
  if (product.stock <= 0) throw new AwardError(`${product.title} is sold out`, 409);
  const perks = perksFor(snap, product.category).filter((k) => req.bid.perkIds.includes(k.id));
  if (perks.length !== req.bid.perkIds.length) throw new AwardError("Bid contains perks we don't offer for this item");
  const price = Math.round(req.bid.price);
  if (price < floorPrice(product, policy, perks)) throw new AwardError("GUARDRAIL: that price breaks our margin rule", 422);

  const addons = perks
    .map((k) => k.addonHandle && snap.catalog.products.find((p) => p.handle === k.addonHandle))
    .filter(Boolean) as Product[];
  const items = [product, ...addons];
  const cost = items.reduce((s, p) => s + p.cost, 0) + perks.filter((k) => !k.addonHandle).reduce((s, k) => s + k.costToMerchant, 0);
  let listTotal = items.reduce((s, p) => s + p.price, 0);
  const title = items.map((p) => p.title).join(" + ");
  const code = makeCode(v.id.slice(0, 6).toUpperCase());
  const expiresAt = Date.now() + policy.codeTtlMinutes * 60_000;

  let checkoutUrl: string | null = null;
  const store = storeFor(v);
  if (store) {
    try {
      const byHandle = await shopifyProducts(store);
      const found = items.map((p) => byHandle.get(p.handle));
      if (found.every(Boolean)) {
        // The cart is priced by Shopify, so the discount is computed from Shopify's list prices.
        listTotal = found.reduce((s, p) => s + p!.price, 0);
        await createDiscountCode(store, {
          code,
          amountOff: Math.max(0, listTotal - price),
          productIds: found.map((p) => p!.id),
          ttlMinutes: policy.codeTtlMinutes,
          title: `Haggle ${req.auctionId.slice(0, 8)} - ${v.name}`,
        });
        checkoutUrl = cartPermalink(store, found.map((p) => p!.variantId), code);
      } else console.warn(`[${v.id}] products not in Shopify (run npm run seed -- --vendor ${v.id}), using mock checkout`);
    } catch (e) {
      console.error(`[${v.id}] Shopify award failed, using mock checkout`, (e as Error).message);
    }
  }
  const liveShopify = !!checkoutUrl;
  if (!checkoutUrl) {
    const q = new URLSearchParams({ code, title, price: String(price), list: String(listTotal), perks: perks.map((k) => k.label).join(", "), exp: String(expiresAt) });
    checkoutUrl = `${publicUrl}/checkout/mock?${q}`;
  }
  console.log(`[${v.id}] awarded ${title} at £${price} (${marginPct(price, cost)}% margin) code ${code}${liveShopify ? " [shopify]" : " [mock]"}`);
  return {
    merchantId: v.id,
    code,
    checkoutUrl,
    listTotal,
    finalPrice: price,
    marginPct: marginPct(price, cost),
    title,
    perks: perks.map((k) => k.label),
    expiresAt,
    liveShopify,
  };
}
