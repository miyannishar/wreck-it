import { type Ctx, type Routes, exportedMethods, page, toPath, lineAt } from "./types.js";

const ROUTE = /^src\/routes\/(?:(.*)\/)?\+(page\.svelte|server\.[jt]s|page\.server\.[jt]s)$/;

const segs = (dir: string | undefined): string[] =>
  (dir ? dir.split("/") : []).filter((s) => !/^\(.*\)$/.test(s)).map((s) => s.replace(/\[(\.\.\.)?(\w+)=\w+\]/g, "[$1$2]"));

export async function sveltekit(ctx: Ctx): Promise<Routes> {
  const out: Routes = { pages: [], api: [] };
  for (const f of ctx.files) {
    const m = ROUTE.exec(f);
    if (!m) continue;
    const path = toPath(segs(m[1]));
    if (m[2] === "page.svelte") { out.pages.push(page(path, f)); continue; }
    const src = await ctx.read(f);
    if (m[2]!.startsWith("page.server")) {
      const a = /export\s+const\s+actions\b/.exec(src);
      if (a) out.api.push({ method: "POST", path, file: f, line: lineAt(src, a.index) });
      continue;
    }
    const ms = exportedMethods(src);
    if (!ms.length) out.api.push({ method: "ANY", path, file: f });
    for (const x of ms) out.api.push({ method: x.method, path, file: f, line: x.line });
  }
  return out;
}
