import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { clearSessionCookie, currentSessionId } from "@/lib/session";

export async function POST(req: NextRequest) {
  const sid = await currentSessionId();
  if (sid) await db.deleteSession(sid);
  const res = NextResponse.redirect(new URL("/logout", req.url), 303);
  clearSessionCookie(res);
  return res;
}
