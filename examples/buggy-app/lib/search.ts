import type { ProductSummary, Review } from "./types";

function editDistance(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function bestMatch(query: string, text: string, tolerance: number): number {
  if (query.length > 24) return text.includes(query) ? 0 : Infinity;
  let best = Infinity;
  for (let start = 0; start + query.length <= text.length; start++) {
    for (let len = Math.max(1, query.length - tolerance); len <= query.length + tolerance; len++) {
      const d = editDistance(query, text.slice(start, start + len));
      if (d < best) best = d;
      if (best === 0) return 0;
    }
  }
  return best;
}

/** Fuzzy, typo-tolerant search across names, descriptions and review text. */
export function searchCatalog(products: ProductSummary[], reviews: Review[], query: string): ProductSummary[] {
  const q = query.toLowerCase();
  const tolerance = Math.max(1, Math.floor(q.length / 3));
  const scored: Array<{ product: ProductSummary; distance: number }> = [];
  for (const product of products) {
    const text = [product.name, product.category, product.description, ...reviews.filter((r) => r.productId === product.id).map((r) => r.body)]
      .join(" ")
      .toLowerCase();
    const distance = bestMatch(q, text, tolerance);
    if (distance <= tolerance) scored.push({ product, distance });
  }
  return scored.sort((a, b) => a.distance - b.distance || a.product.name.localeCompare(b.product.name)).map((s) => s.product);
}
