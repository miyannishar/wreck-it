import { NextResponse } from "next/server";

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<Partial<T>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Partial<T>) : {};
  } catch {
    return {};
  }
}
