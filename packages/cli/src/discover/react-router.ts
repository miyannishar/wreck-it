import { type Ctx, type Routes, page } from "./types.js";
import { remix } from "./remix.js";

const JSX_ROUTE = /<Route\b[^>]*?\bpath=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\})/g;
const OBJ_PATH = /\bpath\s*:\s*["'`]([^"'`]*)["'`]/g;
const ROUTER_API = /createBrowserRouter|createHashRouter|createMemoryRouter|createRoutesFromElements|useRoutes|RouteObject|RouterProvider/;
const CONFIG = /^app\/routes\.[cm]?[jt]s$/;
const CONFIG_ROUTE = /\broute\s*\(\s*["'`]([^"'`]*)["'`]\s*,\s*["'`]([^"'`]+)["'`]/g;
const CONFIG_INDEX = /\bindex\s*\(\s*["'`]([^"'`]+)["'`]/g;

/** "/products/:id" → "/products/[id]", ":x?" → "[[x]]", "*" → "[...splat]". */
export function rrPath(p: string): string {
  const s = p.split("/").filter(Boolean).map((x) => x === "*" ? "[...splat]" : x.replace(/^:(\w+)\?$/, "[[$1]]").replace(/^:(\w+)$/, "[$1]"));
  return "/" + s.join("/");
}

export async function reactRouter(ctx: Ctx): Promise<Routes> {
  const out: Routes = { pages: [], api: [] };
  const push = (p: string, file: string) => { if (p !== "*" && p !== "") out.pages.push(page(rrPath(p), file)); };
  for (const f of ctx.files) {
    if (!/\.[cm]?[jt]sx?$/.test(f)) continue;
    const src = await ctx.read(f);
    if (CONFIG.test(f)) {
      for (const x of src.matchAll(CONFIG_ROUTE)) out.pages.push(page(rrPath(x[1]!), `app/${x[2]!.replace(/^\.\//, "")}`));
      for (const x of src.matchAll(CONFIG_INDEX)) out.pages.push(page("/", `app/${x[1]!.replace(/^\.\//, "")}`));
      if (/flatRoutes\s*\(/.test(src)) { const r = await remix(ctx); out.pages.push(...r.pages); out.api.push(...r.api); }
      continue;
    }
    for (const x of src.matchAll(JSX_ROUTE)) push((x[1] ?? x[2] ?? x[3])!, f);
    if (ROUTER_API.test(src)) for (const x of src.matchAll(OBJ_PATH)) push(x[1]!, f);
  }
  return out;
}
