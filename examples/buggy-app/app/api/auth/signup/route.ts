import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { jsonError, readJson } from "@/lib/http";
import { hashPassword } from "@/lib/password";
import { setSessionCookie, toPublicUser } from "@/lib/session";

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export async function POST(req: NextRequest) {
  const body = await readJson<{ displayName: string; email: string; password: string }>(req);
  const displayName = String(body.displayName ?? "").trim();
  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "");

  if (!displayName) return jsonError(400, "Please tell us your name");
  if (!EMAIL.test(email)) return jsonError(400, "Please enter a valid email address, like you@example.com");
  if (password.length < 8) return jsonError(400, "Password must be at least 8 characters");
  if (await db.findUserByEmail(email)) return jsonError(409, "An account with that email already exists");

  const { salt, hash } = hashPassword(password);
  const user = await db.createUser({
    id: randomUUID(),
    email,
    displayName,
    passwordHash: hash,
    salt,
    createdAt: new Date().toISOString(),
  });
  const sid = await db.createSession(user.id);
  const res = NextResponse.json({ user: toPublicUser(user) }, { status: 201 });
  setSessionCookie(res, sid);
  return res;
}
