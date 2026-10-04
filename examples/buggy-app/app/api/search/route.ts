import { NextResponse, type NextRequest } from "next/server";
import { averageRating } from "@/lib/catalog";
import { db } from "@/lib/db";
import { searchCatalog } from "@/lib/search";
import type { ProductSummary } from "@/lib/types";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("q") ?? "";
  const query = decodeURIComponent(raw).trim();

  const [products, reviews] = await Promise.all([db.listProducts(), db.allReviews()]);
  const summaries: ProductSummary[] = products.map((p) => {
    const own = reviews.filter((r) => r.productId === p.id);
    return { ...p, stock: 0, reviewCount: own.length, rating: averageRating(own) };
  });

  if (!query) return NextResponse.json({ query, products: summaries });
  const results = searchCatalog(summaries, reviews, query);
  return NextResponse.json({ query, products: results });
}
