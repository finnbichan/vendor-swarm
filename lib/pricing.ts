import type { Perk, Policy, Product } from "../bot/schema";

/** Lowest price that keeps the margin rule after paying for any perks. margin = (price - cost - perks) / price */
export function floorPrice(p: Product, policy: Policy, perks: Perk[] = []) {
  const m = (p.clearance ? policy.clearanceMarginPct : policy.minMarginPct) / 100;
  const cost = p.cost + perks.reduce((s, k) => s + k.costToMerchant, 0);
  return Math.ceil(cost / (1 - m));
}

export function marginPct(price: number, cost: number) {
  return Math.round(((price - cost) / price) * 1000) / 10;
}

export const perkValue = (perks: Pick<Perk, "valueToBuyer">[]) => perks.reduce((s, k) => s + k.valueToBuyer, 0);

/** What the buyer agent compares: price minus the perceived value of perks. */
export function effectivePrice(price: number, perks: Pick<Perk, "valueToBuyer">[]) {
  return price - perkValue(perks);
}

export const psychological = (n: number, min: number) => {
  const p = Math.floor(n);
  const nine = Math.floor(p / 10) * 10 - 1;
  return nine >= min && p - nine <= 6 ? nine : p;
};
