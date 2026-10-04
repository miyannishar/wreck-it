import { NextResponse, type NextRequest } from "next/server";
import { applyCoupon, summarize } from "@/lib/cart";
import { db } from "@/lib/db";
import { jsonError, readJson } from "@/lib/http";
import { currentUser } from "@/lib/session";
import type { Order } from "@/lib/types";

export async function GET() {
  const user = await currentUser();
  if (!user) return jsonError(401, "Please log in");
  const orders = await db.ordersFor(user.id);
  orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return NextResponse.json({ orders });
}

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return jsonError(401, "Please log in");
  const body = await readJson<{ address: string; phone: string }>(req);
  const address = String(body.address ?? "").trim();
  const phone = String(body.phone ?? "").trim();
  if (!address) return jsonError(400, "Please enter a delivery address");

  const cart = await db.getCart(user.id);
  if (cart.items.length === 0) return jsonError(400, "Your cart is empty");
  const summary = summarize(cart);

  for (const item of cart.items) await db.reserveStock(item.productId, item.quantity);
  const payment = await db.authorizePayment(summary.total);
  if (!payment.ok) return jsonError(402, "Payment was declined");

  const order: Order = {
    id: await db.nextOrderId(),
    userId: user.id,
    items: cart.items.map((i) => ({ ...i })),
    subtotal: summary.subtotal,
    discount: summary.discount,
    total: applyCoupon(summary.total, cart.coupon),
    couponCode: cart.coupon?.code ?? null,
    address,
    phone,
    status: "placed",
    createdAt: new Date().toISOString(),
  };
  await db.insertOrder(order);
  await db.clearCart(user.id);
  return NextResponse.json({ order }, { status: 201 });
}
