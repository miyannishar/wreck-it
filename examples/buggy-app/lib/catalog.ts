import { db } from "./db";
import type { ProductSummary, Review } from "./types";

function averageRating(reviews: Review[]): number | undefined {
  if (reviews.length === 0) return undefined;
  return reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
}

export async function listProductsWithRatings(): Promise<ProductSummary[]> {
  const products = await db.listProducts();
  const result: ProductSummary[] = [];
  for (const product of products) {
    const reviews = await db.reviewsFor(product.id);
    const stock = await db.stockFor(product.id);
    result.push({ ...product, stock, reviewCount: reviews.length, rating: averageRating(reviews) });
  }
  return result;
}

export async function getProductDetail(id: string) {
  const product = await db.getProduct(id);
  if (!product) return null;
  const [reviews, stock] = await Promise.all([db.reviewsFor(id), db.stockFor(id)]);
  return { ...product, stock, reviews, reviewCount: reviews.length, rating: averageRating(reviews) };
}

export { averageRating };
