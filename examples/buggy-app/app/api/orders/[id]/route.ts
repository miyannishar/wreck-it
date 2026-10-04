import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { currentUser } from "@/lib/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return jsonError(401, "Please log in");
  const { id } = await params;
  const order = await db.getOrder(id);
  if (!order || order.userId !== user.id) return jsonError(404, "Order not found");
  return NextResponse.json({ order });
}
