import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { db } from "./db";
import type { PublicUser, User } from "./types";

export const SESSION_COOKIE = "gadgetly_sid";

export async function currentUser(): Promise<User | null> {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  const userId = await db.sessionUserId(sid);
  return userId ? db.getUser(userId) : null;
}

export async function currentSessionId(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export function setSessionCookie(res: NextResponse, sid: string): void {
  res.cookies.set(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, displayName: user.displayName };
}
