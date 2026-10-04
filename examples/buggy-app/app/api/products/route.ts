import { NextResponse } from "next/server";
import { listProductsWithRatings } from "@/lib/catalog";

export async function GET() {
  const products = await listProductsWithRatings();
  return NextResponse.json({ products });
}
