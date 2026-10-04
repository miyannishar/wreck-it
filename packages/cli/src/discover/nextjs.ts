import { type Ctx, type Routes, type Api, exportedMethods, page, toPath, lineAt, METHODS } from "./types.js";

const APP = /^(?:src\/)?app\/(?:(.*)\/)?(page|route)\.(?:tsx|jsx|ts|js)$/;
const PAGES = /^(?:src\/)?pages\/(.+)\.(?:tsx|jsx|ts|js)$/;

/** App-router segments → URL segments; null when the file lives under a @slot or _private folder. */
function appSegs(dir: string | undefined): string[] | null {
  const segs = dir ? dir.split("/") : [];
  if (segs.some((s) => s.startsWith("@") || s.startsWith("_"))) return null;
  return segs.filter((s) => !/^\(.*\)$/.test(s));
}

export function hasAppRouter(files: string[]): boolean { return files.some((f) => APP.test(f)); }
export function hasPagesRouter(files: string[]): boolean { return files.some((f) => PAGES.test(f) && !/(?:^|\/)_/.test(f.replace(/^(?:src\/)?pages\//, ""))); }

export async function nextApp(ctx: Ctx): Promise<Routes> {
  const out: Routes = { pages: [], api: [] };
  for (const f of ctx.files) {
    const m = APP.exec(f);
    if (!m) continue;
    const segs = appSegs(m[1]);
    if (!segs) continue;
    const path = toPath(segs);
    if (m[2] === "page") { out.pages.push(page(path, f)); continue; }
    const ms = exportedMethods(await ctx.read(f));
    if (!ms.length) out.api.push({ method: "ANY", path, file: f });
    for (const x of ms) out.api.push({ method: x.method, path, file: f, line: x.line });
  }
  return out;
}

/** `req.method === "POST"` / `case "POST":` checks in a pages/api handler. */
function reqMethods(src: string): { method: string; line: number }[] {
  const seen = new Map<string, number>();
  const re = new RegExp(`req\\.method\\s*[!=]==?\\s*["'\`](${METHODS.join("|")})["'\`]|case\\s+["'\`](${METHODS.join("|")})["'\`]\\s*:`, "g");
  if (!/req\.method/.test(src)) return [];
  for (const x of src.matchAll(re)) { const k = (x[1] ?? x[2])!; if (!seen.has(k)) seen.set(k, lineAt(src, x.index!)); }
  return [...seen].map(([method, line]) => ({ method, line }));
}

export async function nextPages(ctx: Ctx): Promise<Routes> {
  const out: Routes = { pages: [], api: [] };
  for (const f of ctx.files) {
    const m = PAGES.exec(f);
    if (!m) continue;
    const segs = m[1]!.split("/");
    if (segs.some((s) => s.startsWith("_"))) continue;
    if (segs[segs.length - 1] === "index") segs.pop();
    const path = toPath(segs);
    if (segs[0] !== "api") { out.pages.push(page(path, f)); continue; }
    const ms = reqMethods(await ctx.read(f));
    const api: Api[] = ms.length ? ms.map((x) => ({ method: x.method, path, file: f, line: x.line })) : [{ method: "ANY", path, file: f }];
    out.api.push(...api);
  }
  return out;
}
