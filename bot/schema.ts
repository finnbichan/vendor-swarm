// Private, bot-side shapes: vendor.json and catalog.json. These include costs and must
// never be serialised to anyone except the authenticated owner on /admin.
import { z } from "zod";
import { providerIds } from "../lib/config";

export const PerkSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  costToMerchant: z.number().min(0),
  valueToBuyer: z.number().min(0), // perceived value in GBP
  addonHandle: z.string().optional(), // physical add-on that goes in the cart
  deliveryDays: z.number().int().min(0).optional(), // overrides delivery time if chosen
  categories: z.array(z.string()).optional(), // only offered for these categories
});
export type Perk = z.infer<typeof PerkSchema>;

export const PolicySchema = z
  .object({
    strategy: z.string(),
    minMarginPct: z.number().min(0).max(90),
    clearanceMarginPct: z.number().min(0).max(90),
    perksFirst: z.boolean(),
    codeTtlMinutes: z.number().int().min(1).max(1440),
  })
  .refine((p) => p.clearanceMarginPct <= p.minMarginPct, {
    message: "Clearance margin can't be higher than the normal margin",
    path: ["clearanceMarginPct"],
  });
export type Policy = z.infer<typeof PolicySchema>;

export const VoiceSchema = z.object({
  // Templates: {price} {perks} {rival} {margin}
  opening: z.string(),
  counter: z.string(),
  hold: z.string(),
  withdraw: z.string(),
});

// Which model negotiates for this vendor. Provider ids map to operator-configured endpoints
// and keys (lib/config.ts), so owners never handle URLs or keys.
export const LlmSchema = z.object({
  provider: z.string().refine((p) => providerIds.includes(p), { message: `Provider must be one of: ${providerIds.join(", ")}` }).optional(),
  model: z.string().max(120).optional(),
  temperature: z.number().min(0).max(2).optional(),
});
export type LlmSelection = z.infer<typeof LlmSchema>;

export const VendorSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  tagline: z.string(),
  logo: z.string(),
  accent: z.string(),
  port: z.number().int(),
  personality: z.string(),
  deliveryDays: z.number().int().min(0),
  strategy: z.string(),
  minMarginPct: z.number().min(0).max(90),
  clearanceMarginPct: z.number().min(0).max(90),
  perksFirst: z.boolean(),
  codeTtlMinutes: z.number().int().min(1).max(1440),
  scripted: z.object({
    openingDiscountPct: z.number().min(0).max(50), // round-1 discount off list
    undercut: z.number().min(1).max(50), // how many £ of score to beat the leader by
  }),
  voice: VoiceSchema,
  perks: z.array(PerkSchema).min(1).max(3),
  llm: LlmSchema.optional(),
  shopify: z.object({ domainEnv: z.string(), tokenEnv: z.string() }),
});
export type Vendor = z.infer<typeof VendorSchema>;

export const CompetitorSchema = z.object({ store: z.string(), price: z.number(), url: z.string() });

export const ProductSchema = z.object({
  handle: z.string().regex(/^[a-z0-9-]+$/, "Handle: lowercase letters, digits and dashes"),
  category: z.string(),
  title: z.string().min(1),
  description: z.string(),
  price: z.number().positive(),
  cost: z.number().min(0),
  stock: z.number().int().min(0),
  emoji: z.string(),
  comparatorQuery: z.string(),
  mockCompetitors: z.array(CompetitorSchema),
  clearance: z.boolean().optional(),
  hidden: z.boolean().optional(), // add-ons that only appear inside a perk
  image: z.string().optional(),
});
export type Product = z.infer<typeof ProductSchema>;

export const CatalogSchema = z.object({ products: z.array(ProductSchema) });
export type Catalog = z.infer<typeof CatalogSchema>;

export const CategorySchema = z.object({ id: z.string(), label: z.string(), emoji: z.string(), keywords: z.array(z.string()) });
export type Category = z.infer<typeof CategorySchema>;

export const policyOf = (v: Vendor): Policy => ({
  strategy: v.strategy,
  minMarginPct: v.minMarginPct,
  clearanceMarginPct: v.clearanceMarginPct,
  perksFirst: v.perksFirst,
  codeTtlMinutes: v.codeTtlMinutes,
});

/** Cross-file checks that zod can't express on one file alone. Returns human-readable problems. */
export function validateVendorCatalog(v: Vendor, c: Catalog, categoryIds: string[]): string[] {
  const errs: string[] = [];
  if (v.clearanceMarginPct > v.minMarginPct) errs.push("Clearance margin can't be higher than the normal margin.");
  const handles = new Set<string>();
  for (const p of c.products) {
    if (handles.has(p.handle)) errs.push(`Duplicate handle "${p.handle}".`);
    handles.add(p.handle);
    if (!categoryIds.includes(p.category)) errs.push(`${p.title}: unknown category "${p.category}".`);
    const m = (p.clearance ? v.clearanceMarginPct : v.minMarginPct) / 100;
    const floor = Math.ceil(p.cost / (1 - m));
    if (!p.hidden && p.price < floor)
      errs.push(`${p.title}: list price £${p.price} is below its £${floor} floor at ${Math.round(m * 100)}% margin.`);
  }
  for (const k of v.perks) if (k.addonHandle && !handles.has(k.addonHandle)) errs.push(`Perk "${k.label}" points at missing add-on "${k.addonHandle}".`);
  const visible = c.products.filter((p) => !p.hidden).length;
  if (visible < 1) errs.push("The catalogue needs at least one product to sell.");
  return errs;
}
