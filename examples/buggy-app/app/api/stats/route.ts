import { NextResponse, type NextRequest } from "next/server";
import { store } from "@/lib/store";

type Visit = {
  at: number;
  visitor: string;
  page: string;
  headers: Record<string, string>;
  trending: Array<{ id: string; name: string; price: number }>;
};

const g = globalThis as typeof globalThis & { __gadgetlyVisits?: Visit[] };
const visits: Visit[] = (g.__gadgetlyVisits ??= []);

export async function GET(req: NextRequest) {
  const now = Date.now();
  const headers = Object.fromEntries(req.headers);
  visits.push({
    at: now,
    visitor: `${headers["x-forwarded-for"] ?? "local"}|${headers["user-agent"] ?? ""}`,
    page: req.nextUrl.searchParams.get("page") ?? "/",
    headers,
    trending: store.products.slice(0, 6).map(({ id, name, price }) => ({ id, name, price })),
  });

  const recent = visits.filter((v) => now - v.at < 5 * 60_000);
  const online = new Set(recent.map((v) => v.visitor)).size;
  return NextResponse.json({ shoppersOnline: Math.max(online, 1) + 11, pageViews: visits.length });
}
