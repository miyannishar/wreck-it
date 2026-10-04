import { type Ctx, type Routes, lineAt } from "./types.js";

const SERVER_FILE = /\.(?:[cm]?[jt]s)$/;
const NOT_SERVER = new Set(["axios", "ky", "got", "superagent", "request", "supertest", "agent", "http", "https", "client", "fetcher", "$http", "cy", "page", "test", "it", "describe"]);
const VERB = /\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|patch|delete|options|head|all)\s*\(\s*(["'`])(\/[^"'`]*)\3/g;
const ROUTE_OBJ = /\.route\s*\(\s*\{([\s\S]{0,400}?)\}\s*\)/g;
const HONO_ON = /\b[A-Za-z_$][\w$]*\s*\.\s*on\s*\(\s*(["'`])([A-Za-z]+)\1\s*,\s*(["'`])(\/[^"'`]*)\3/g;
const MOUNT = /\b[A-Za-z_$][\w$]*\s*\.\s*(?:use|route|register)\s*\(\s*(["'`])(\/[^"'`]+)\1\s*,/g;

/** Regex scan of express/fastify/hono-style route registrations in .js/.ts files. */
export async function servers(ctx: Ctx): Promise<Routes> {
  const out: Routes = { pages: [], api: [] };
  const mounts: string[] = [];
  for (const f of ctx.files) {
    if (!SERVER_FILE.test(f) || /(?:^|\/)(?:test|tests|__tests__|e2e)\/|\.(?:test|spec)\.[cm]?[jt]s$/.test(f)) continue;
    const src = await ctx.read(f);
    for (const x of src.matchAll(VERB)) {
      if (NOT_SERVER.has(x[1]!)) continue;
      out.api.push({ method: x[2] === "all" ? "ANY" : x[2]!.toUpperCase(), path: x[4]!, file: f, line: lineAt(src, x.index!) });
    }
    for (const x of src.matchAll(ROUTE_OBJ)) {
      const body = x[1]!;
      const url = /\b(?:url|path)\s*:\s*(["'`])(\/[^"'`]*)\1/.exec(body)?.[2];
      if (!url) continue;
      const mm = /\bmethod\s*:\s*(\[[^\]]*\]|["'`][A-Za-z]+["'`])/.exec(body)?.[1] ?? "";
      const methods = [...mm.matchAll(/["'`]([A-Za-z]+)["'`]/g)].map((y) => y[1]!.toUpperCase());
      for (const method of methods.length ? methods : ["ANY"]) out.api.push({ method, path: url, file: f, line: lineAt(src, x.index!) });
    }
    for (const x of src.matchAll(HONO_ON)) out.api.push({ method: x[2]!.toUpperCase(), path: x[4]!, file: f, line: lineAt(src, x.index!) });
    for (const x of src.matchAll(MOUNT)) mounts.push(`${x[2]} (${f}:${lineAt(src, x.index!)})`);
  }
  if (mounts.length) ctx.warn(`routers mounted under prefixes ${mounts.slice(0, 5).join(", ")}${mounts.length > 5 ? ", …" : ""}; nested api paths may be missing the prefix`);
  return out;
}
