import { type Ctx, type Routes, page, toPath, lineAt } from "./types.js";

const ROUTE = /^app\/routes\/(?:([^/]+)\.(?:tsx|jsx|ts|js)|([^/]+)\/route\.(?:tsx|jsx|ts|js))$/;

/** Remix v2 flat-file segment → URL segment ("" = no URL segment). */
function seg(s: string): string {
  if (s === "_index" || s.startsWith("_")) return "";
  s = s.replace(/_$/, "");
  if (s === "$") return "[...splat]";
  const opt = /^\((.*)\)$/.exec(s);
  if (opt) return opt[1]!.startsWith("$") ? `[[${opt[1]!.slice(1)}]]` : opt[1]!;
  if (s.startsWith("$")) return `[${s.slice(1)}]`;
  return s.replace(/\[([^\]]*)\]/g, "$1");
}

export function flatRoutePath(name: string): string {
  const parts = name.replace(/\[\.\]/g, "\0").split(".").map((p) => p.replace(/\0/g, "."));
  return toPath(parts.map(seg));
}

const exported = (src: string, name: string): number | undefined => {
  const m = new RegExp(`export\\s+(?:async\\s+)?(?:function|const|let)\\s+${name}\\b`).exec(src);
  return m ? lineAt(src, m.index) : undefined;
};

/** Flat-routes convention under app/routes (Remix v2, @react-router/fs-routes). */
export async function remix(ctx: Ctx): Promise<Routes> {
  const out: Routes = { pages: [], api: [] };
  for (const f of ctx.files) {
    const m = ROUTE.exec(f);
    if (!m) continue;
    const path = flatRoutePath((m[1] ?? m[2])!);
    const src = await ctx.read(f);
    const loader = exported(src, "loader"), action = exported(src, "action");
    if (/export\s+default\b/.test(src) || (loader === undefined && action === undefined)) out.pages.push(page(path, f));
    if (loader !== undefined) out.api.push({ method: "GET", path, file: f, line: loader });
    if (action !== undefined) out.api.push({ method: "POST", path, file: f, line: action });
  }
  return out;
}
