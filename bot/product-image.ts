// Product images without external hosting: every bot renders an SVG card per product
// (vendor colour, product emoji, title). A real `image` URL on the product overrides it.
import type { Product, Vendor } from "./schema";

/** The image a buyer sees for a product: its own URL if an owner set one, else our generated card. */
export const imageUrl = (p: Pick<Product, "handle" | "image">, publicUrl: string) => p.image || `${publicUrl}/images/${p.handle}.svg`;

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Owner-editable, so only a plain #rrggbb / #rgb colour is trusted; anything else gets a neutral slate. */
function hex(accent: string) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(accent.trim());
  if (!m) return "#475569";
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${h.toLowerCase()}`;
}

function shade(color: string, f: number) {
  const n = parseInt(color.slice(1), 16);
  const ch = (shift: number) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * f)));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

/** Greedy word wrap into at most `max` lines of ~`width` characters, with an ellipsis if it overflows. */
function wrap(text: string, width: number, max: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if ((line + " " + word).trim().length <= width) line = (line + " " + word).trim();
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > max) {
    lines.length = max;
    lines[max - 1] = lines[max - 1].replace(/.{0,2}$/, "…");
  }
  return lines;
}

export function productCardSvg(p: Pick<Product, "title" | "emoji" | "clearance">, v: Pick<Vendor, "name" | "logo" | "accent">) {
  const base = hex(v.accent);
  const top = shade(base, 1.15);
  const bottom = shade(base, 0.55);
  const lines = wrap(p.title, 24, 2);
  const titleY = lines.length === 1 ? 470 : 448;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600" role="img" aria-label="${esc(p.title)} from ${esc(v.name)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${top}"/>
      <stop offset="1" stop-color="${bottom}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.38" r="0.45">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="800" height="600" fill="url(#bg)"/>
  <rect width="800" height="600" fill="url(#glow)"/>
  <text x="400" y="300" text-anchor="middle" font-size="190" font-family="'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif">${esc(p.emoji)}</text>
  <g font-family="system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" fill="#ffffff" text-anchor="middle">
    ${lines.map((l, i) => `<text x="400" y="${titleY + i * 50}" font-size="42" font-weight="700">${esc(l)}</text>`).join("\n    ")}
    <text x="400" y="560" font-size="24" fill-opacity="0.85">${esc(v.logo)} ${esc(v.name)}</text>
  </g>
  ${p.clearance ? `<g><rect x="600" y="28" width="172" height="44" rx="22" fill="#ffffff" fill-opacity="0.92"/><text x="686" y="58" text-anchor="middle" font-family="system-ui,sans-serif" font-size="20" font-weight="700" fill="${bottom}">CLEARANCE</text></g>` : ""}
</svg>`;
}
