import { NextResponse, type NextRequest } from "next/server";
import { summarize } from "@/lib/cart";
import { db } from "@/lib/db";
import { jsonError, readJson } from "@/lib/http";
import { currentUser } from "@/lib/session";

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return jsonError(401, "Please log in");
  const body = await readJson<{ code: string }>(req);
  const input = String(body.code ?? "");
  if (!input.trim()) return jsonError(400, "Enter a coupon code");

  const active = await db.activeCouponCodes();
  if (!active.includes(input.trim().toUpperCase())) return jsonError(400, "That coupon code isn't valid");

  const coupon = await db.getCoupon(input.toUpperCase());
  const cart = await db.getCart(user.id);
  cart.coupon = { code: coupon.code, percent: coupon.percent };
  await db.saveCart(user.id, cart);
  return NextResponse.json(summarize(cart));
}

export async function DELETE() {
  const user = await currentUser();
  if (!user) return jsonError(401, "Please log in");
  const cart = await db.getCart(user.id);
  cart.coupon = null;
  await db.saveCart(user.id, cart);
  return NextResponse.json(summarize(cart));
}
