import { NextResponse } from "next/server";
import { getProductDetail } from "@/lib/catalog";
import { jsonError } from "@/lib/http";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await getProductDetail(id);
  if (!product) return jsonError(404, "Product not found");
  return NextResponse.json({ product });
}
