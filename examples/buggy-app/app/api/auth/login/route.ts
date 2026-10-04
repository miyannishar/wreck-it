import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { jsonError, readJson } from "@/lib/http";
import { verifyPassword } from "@/lib/password";
import { setSessionCookie, toPublicUser } from "@/lib/session";

export async function POST(req: NextRequest) {
  const body = await readJson<{ email: string; password: string }>(req);
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");
  const user = email ? await db.findUserByEmail(email) : null;
  if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
    return jsonError(401, "Incorrect email or password");
  }
  const sid = await db.createSession(user.id);
  const res = NextResponse.json({ user: toPublicUser(user) });
  setSessionCookie(res, sid);
  return res;
}
