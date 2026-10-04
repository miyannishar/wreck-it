import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { jsonError, readJson } from "@/lib/http";
import { currentUser, toPublicUser } from "@/lib/session";

export async function GET() {
  const user = await currentUser();
  if (!user) return jsonError(401, "Please log in");
  return NextResponse.json({ user: toPublicUser(user) });
}

export async function PATCH(req: NextRequest) {
  const user = await currentUser();
  if (!user) return jsonError(401, "Please log in");
  const body = await readJson<{ displayName: string }>(req);
  const displayName = String(body.displayName ?? "").trim();
  if (!displayName) return jsonError(400, "Display name can't be empty");
  if (displayName.length > 60) return jsonError(400, "Display name must be 60 characters or fewer");
  const updated = await db.updateUser(user.id, { displayName });
  if (!updated) return jsonError(404, "Account not found");
  return NextResponse.json({ ok: true, user: toPublicUser(updated) });
}
