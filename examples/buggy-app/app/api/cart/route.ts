import { NextResponse, type NextRequest } from "next/server";
import { summarize } from "@/lib/cart";
import { db } from "@/lib/db";
import { jsonError, readJson } from "@/lib/http";
import { currentUser } from "@/lib/session";

export async function GET() {
  const user = await currentUser();
  if (!user) return jsonError(401, "Please log in to view your cart");
  const cart = await db.getCart(user.id);
  return NextResponse.json(summarize(cart));
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return jsonError(401, "Please log in to add items to your cart");
  const body = await readJson<{ productId: string; quantity: number }>(req);
  const product = await db.getProduct(String(body.productId ?? ""));
  if (!product) return jsonError(404, "Product not found");

  const quantity = Number(body.quantity) || 1;
  const cart = await db.getCart(user.id);
  const existing = cart.items.find((i) => i.productId === product.id);
  if (existing) existing.quantity += quantity;
  else cart.items.push({ productId: product.id, name: product.name, price: product.price, quantity });
  cart.count += quantity;
  await db.saveCart(user.id, cart);
  return NextResponse.json(summarize(cart), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const user = await currentUser();
  if (!user) return jsonError(401, "Please log in");
  const body = await readJson<{ productId: string; quantity: number }>(req);
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity)) return jsonError(400, "Quantity must be a number");

  const cart = await db.getCart(user.id);
  const item = cart.items.find((i) => i.productId === String(body.productId));
  if (!item) return jsonError(404, "Item not in cart");
  if (quantity === 0) cart.items = cart.items.filter((i) => i !== item);
  else item.quantity = Math.trunc(quantity);
  await db.saveCart(user.id, cart);
  return NextResponse.json(summarize(cart));
}

export async function DELETE(req: NextRequest) {
  const user = await currentUser();
  if (!user) return jsonError(401, "Please log in");
  const productId = req.nextUrl.searchParams.get("productId");
  const cart = await db.getCart(user.id);
  cart.items = cart.items.filter((i) => i.productId !== productId);
  await db.saveCart(user.id, cart);
  return NextResponse.json(summarize(cart));
}
