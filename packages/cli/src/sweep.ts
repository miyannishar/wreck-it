import type { BrowserContext, Page } from "playwright";
import { ODDITY_SCRIPT } from "./oddity.js";
import { axeOnPage, recordViolations, writeResult, parseViewport, type A11yResult } from "./a11y.js";
import { launchChromium, openSettled } from "./browser.js";
import { addFinding, listFindings, writeAtomic } from "./findings.js";
import { recordVisit } from "./run.js";
import { openSession, saveRefreshed } from "./auth.js";
import type { Config } from "./config.js";
import { wreckPaths, ensureDirs } from "./paths.js";
import { resolveTarget, isExcluded, pagesOf, type SavedDiscovery, inScope } from "./context.js";
import type { FindingInput } from "./schema.js";

interface Signal { kind: string; detail: string; selector?: string }
interface Visit { route: string; viewport: string; signals: Signal[]; consoleErrors: string[]; serverErrors: string[]; error?: string }
/** One root cause seen on one or more pages; `key` identifies it across pages and on the reproduction visit. */
interface Candidate { key: string; kind: string; route: string; url: string; width: number; height: number; example: string; routes: Set<string>; extra?: string }
export interface SweepResult {
  baseUrl: string; loggedIn: boolean | null; viewports: string[]; pages: string[]; visits: Visit[];
  a11y: A11yResult[]; candidates: { kind: string; example: string; routes: string[] }[];
  recorded: string[]; skipped: string[]; warnings: string[];
}

const patternRe = (p: string) => new RegExp("^" + p.split("/").map((s) => (/^\[.+\]$/.test(s) ? "[^/]+" : s.replace(/[.*+?^${}()|\\]/g, "\\$&"))).join("/") + "$");

async function visit(page: Page, url: string, origin: string): Promise<Omit<Visit, "route" | "viewport"> & { links: string[] }> {
  const consoleErrors: string[] = [], serverErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => consoleErrors.push(e.message.slice(0, 300)));
  page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(origin)) serverErrors.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
  try {
    await openSettled(page, url);
    const odd = (await page.evaluate(`(${ODDITY_SCRIPT})()`)) as { signals: Signal[] };
    const links = (await page.evaluate(`Array.from(document.querySelectorAll("a[href]")).map((a) => a.href)`)) as string[];
    return { signals: odd.signals, consoleErrors, serverErrors: [...new Set(serverErrors)], links: links.filter((l) => l.startsWith(origin)) };
  } catch (e) {
    return { signals: [], consoleErrors, serverErrors, links: [], error: (e as Error).message.split("\n")[0] };
  }
}

/** Turn page signals into root-cause candidates. Only kinds a script can judge reliably are recorded. */
function candidatesOf(v: Omit<Visit, "route" | "viewport">, route: string, url: string, w: number, h: number): Candidate[] {
  const out: Candidate[] = [];
  const c = (key: string, kind: string, example: string, extra?: string) => out.push({ key, kind, route, url, width: w, height: h, example, routes: new Set([route]), extra });
  for (const s of v.signals) {
    if (s.kind === "rendered-placeholder") {
      const token = /"([^"]+)"/.exec(s.detail)?.[1] ?? "placeholder";
      c(`placeholder:${token}`, s.kind, s.detail.replace(/^text contains "[^"]+": /, ""), token);
    } else if (s.kind === "broken-image") {
      const src = s.detail.replace(/^image failed to load: /, "");
      c(`image:${src}`, s.kind, src, src);
    } else if (s.kind === "dead-link") {
      const [href, status] = s.detail.split(" -> ");
      c(`link:${href}`, s.kind, `${href} → ${status}`, href);
    } else if (s.kind === "horizontal-overflow" && !s.selector && w <= 480) {
      c(`overflow:${w}:${route}`, s.kind, s.detail);
    }
  }
  for (const e of v.serverErrors) c(`5xx:${e.replace(/ \d+$/, "")}`, "server-error", e, e);
  return out;
}

function findingFor(c: Candidate, base: string, auth?: string): FindingInput {
  const others = [...c.routes].filter((r) => r !== c.route);
  const also = others.length ? ` Also on: ${others.slice(0, 8).join(", ")}${others.length > 8 ? ", …" : ""}.` : "";
  const open = [{ action: "setViewport" as const, width: c.width, height: c.height }, { action: "goto" as const, url: c.route }];
  const common = { persona: "sweep", route: c.route, reproduced: false, ...(auth ? { auth } : {}) };
  switch (c.kind) {
    case "rendered-placeholder":
      return { ...common, title: `Page renders "${c.extra}" as visible text`, category: "oddity", severity: "medium", steps: open,
        assertions: [{ kind: "text", target: { by: "css", value: "body" }, contains: c.extra!, negate: true }],
        expected: "Missing values are shown as a sensible fallback (e.g. \"No reviews yet\"), never as raw placeholders",
        actual: `Visible text on ${c.route} contains "${c.extra}", e.g. "${c.example}".${also}` };
    case "broken-image": {
      const src = new URL(c.extra!, base);
      return { ...common, title: `Broken image: ${src.pathname}`, category: "oddity", severity: "low",
        steps: [...open, { action: "http", method: "GET", url: src.pathname + src.search }], assertions: [{ kind: "httpStatus", below: 400 }],
        expected: "Every image on the page loads", actual: `${src.href} fails to load on ${c.route}.${also}` };
    }
    case "dead-link": {
      const href = new URL(c.extra!, base);
      return { ...common, title: `Dead link: ${href.pathname} (${c.example.split(" → ")[1]})`, category: "oddity", severity: "low",
        steps: [...open, { action: "http", method: "GET", url: href.pathname + href.search }], assertions: [{ kind: "httpStatus", below: 400 }],
        expected: "Links on the page lead to existing pages", actual: `A link on ${c.route} points to ${href.pathname}, which returns ${c.example.split(" → ")[1]}.${also}` };
    }
    case "horizontal-overflow":
      return { ...common, title: `${c.route} scrolls horizontally at ${c.width}px (mobile)`, category: "ux", severity: "medium", steps: open, assertions: [],
        expected: `Page fits a ${c.width}px-wide viewport without sideways scrolling`, actual: `On ${c.route} at ${c.width}px: ${c.example}.` };
    default:
      return { ...common, title: `${c.extra} while loading ${c.route}`, category: "functional", severity: "high", steps: open, assertions: [{ kind: "noServerErrors" }],
        expected: "Page loads without server errors", actual: `${c.extra} when ${c.route} loads.${also}` };
  }
}

export interface SweepOptions {
  baseUrl?: string; viewports?: string; record?: boolean; iOwnThis?: boolean; a11y?: boolean; account?: string;
  /** Focused run: only these routes and the ones below them. */
  only?: string[];
}
interface Viewport { label: string; width: number; height: number }
interface Crawl { visits: Visit[]; a11y: A11yResult[]; cands: Map<string, Candidate> }
/** What one sweep shares between its crawl, reproduction and reporting steps. */
interface SweepEnv {
  root: string; base: string; origin: string; auth?: string; withA11y: boolean; warnings: string[]; out: Crawl;
  newCtx: (vp: { width: number; height: number }) => Promise<BrowserContext>;
}

/** Static pages to visit, plus dynamic patterns (/products/[id]) to fill from links found on the way. */
function planRoutes(cfg: Config, disc: SavedDiscovery | undefined, base: string, warnings: string[], only?: string[]): { routes: string[]; dynamics: string[] } {
  const all = pagesOf(disc);
  if (!all.length && !only?.length) warnings.push("no pages in .wreck-it/discovery.json; sweeping / only (run `wreck-it discover` first)");
  const keep = all.filter((x) => !isExcluded(cfg, x.path, { api: true }) && inScope(x.path, only));
  const statics = keep.filter((x) => !x.dynamic).map((x) => x.path);
  // A focused route discovery didn't list (e.g. a page behind a client-side router) is still swept as given.
  const fallback = only?.length ? only.filter((o) => !o.includes("[")) : ["/"];
  // --only values and discovery.json (which may be hand-edited) are just text: a route that resolves to another host
  // (`//x`, `http://x`, `/\x`) would take the browser off the app, so only same-origin paths are swept.
  const origin = new URL(base).origin;
  const local = (r: string) => {
    let ok = false;
    try { ok = r.startsWith("/") && new URL(r, base).origin === origin; } catch { /* not a path */ }
    if (!ok) warnings.push(`skipped route ${r}: not a path on ${origin}`);
    return ok;
  };
  const routes = (statics.length ? [...new Set(statics)] : fallback).filter(local);
  return { routes: routes.length || only?.length ? routes : ["/"], dynamics: keep.filter((x) => x.dynamic).map((x) => x.path).filter(local) };
}

/** Queue the first link matching each still-unfilled dynamic route pattern. */
function claimDynamicRoutes(links: string[], pending: Set<string>, queue: string[]): void {
  for (const pat of [...pending]) {
    const hit = links.map((l) => new URL(l).pathname).find((path) => patternRe(pat).test(path) && !queue.includes(path));
    if (hit) { queue.push(hit); pending.delete(pat); }
  }
}

async function crawlViewport(env: SweepEnv, ctx: BrowserContext, vp: Viewport, first: boolean, routes: string[], dynamics: string[]): Promise<void> {
  const { root, base, origin, warnings, out } = env;
  const queue = [...routes];
  const pending = new Set(dynamics);
  for (let k = 0; k < queue.length; k++) {
    const route = queue[k]!;
    const url = new URL(route, base).href;
    const page = await ctx.newPage();
    const r = await visit(page, url, origin);
    claimDynamicRoutes(r.links, pending, queue);
    if (first && env.withA11y && !r.error) {
      try { out.a11y.push(await axeOnPage(page, url)); } catch (e) { warnings.push(`axe failed on ${route}: ${(e as Error).message.split("\n")[0]}`); }
    }
    await page.close().catch(() => {});
    const { links: _l, ...v } = r;
    out.visits.push({ route, viewport: vp.label, ...v });
    if (r.error) { warnings.push(`could not load ${route} at ${vp.label}: ${r.error}`); continue; }
    await recordVisit(root, route, "sweep");
    for (const c of candidatesOf(v, route, url, vp.width, vp.height)) {
      const prev = out.cands.get(c.key);
      if (prev) prev.routes.add(route); else out.cands.set(c.key, c);
    }
  }
  if (first) for (const pat of pending) warnings.push(`no link found for dynamic route ${pat}; not swept`);
}

/** Findings for every candidate, each re-visited in a fresh context first, then the axe violations. */
async function recordSweep(env: SweepEnv): Promise<{ recorded: string[]; skipped: string[] }> {
  const { root, base, origin, auth, out } = env;
  const recorded: string[] = [], skipped: string[] = [];
  await ensureDirs(wreckPaths(root));
  const { findings: existing } = await listFindings(root);
  for (const c of out.cands.values()) {
    const input = findingFor(c, base, auth);
    const dup = existing.find((f) => f.persona === "sweep" && f.title === input.title);
    if (dup) { skipped.push(`${dup.id} already records: ${input.title}`); continue; }
    const ctx = await env.newCtx({ width: c.width, height: c.height });
    const page = await ctx.newPage();
    const again = await visit(page, c.url, origin);
    await ctx.close();
    input.reproduced = candidatesOf(again, c.route, c.url, c.width, c.height).some((x) => x.key === c.key);
    const { finding } = await addFinding(root, input);
    recorded.push(finding.id);
  }
  for (const r of out.a11y) recorded.push(...(await recordViolations(root, r)));
  for (const r of out.a11y) await writeResult(root, r);
  return { recorded, skipped };
}

export async function runSweep(root: string, opts: SweepOptions): Promise<SweepResult> {
  const { p, cfg, disc, base } = await resolveTarget(root, opts);
  const vps = (opts.viewports ?? "1280x800,390x844").split(",").map((v) => v.trim()).filter(Boolean);
  const sizes = vps.map(parseViewport);
  const warnings: string[] = [];
  const { routes, dynamics } = planRoutes(cfg, disc, base, warnings, opts.only);

  const browser = await launchChromium();
  try {
    const session = await openSession(browser, root, base, routes, opts.account);
    if (cfg.accounts.length) warnings.push(...session.warnings);
    const storageState = session.state;
    // Each context starts from the latest session, not the original: apps that rotate refresh tokens revoke reused ones.
    let current = storageState;
    const env: SweepEnv = {
      root, base, origin: new URL(base).origin, withA11y: opts.a11y !== false, warnings,
      ...(storageState ? { auth: session.label } : {}),
      out: { visits: [], a11y: [], cands: new Map() },
      newCtx: (vp) => browser.newContext({ viewport: vp, ...(current ? { storageState: current } : {}) }),
    };
    for (const [i, vp] of sizes.entries()) {
      const ctx = await env.newCtx(vp);
      await crawlViewport(env, ctx, { label: vps[i]!, ...vp }, i === 0, routes, dynamics);
      if (current) current = await ctx.storageState().catch(() => current);
      await ctx.close();
    }
    const { recorded, skipped } = opts.record ? await recordSweep(env) : { recorded: [], skipped: [] };
    if (current && current !== storageState) await saveRefreshed(root, base, session.label, current);
    const { visits, a11y, cands } = env.out;
    const result: SweepResult = {
      baseUrl: base, loggedIn: session.loggedIn, viewports: vps, pages: [...new Set(visits.map((v) => v.route))], visits, a11y,
      candidates: [...cands.values()].map((c) => ({ kind: c.kind, example: c.example, routes: [...c.routes] })),
      recorded: [...new Set(recorded)], skipped, warnings,
    };
    await ensureDirs(p);
    await writeAtomic(`${p.dir}/sweep.json`, JSON.stringify(result, null, 2));
    return result;
  } finally { await browser.close().catch(() => {}); }
}

export function formatSweep(r: SweepResult): string {
  const where = (routes: string[]) => (routes.length > 3 ? `${routes.length} pages` : routes.join(", "));
  const l = [`swept ${r.pages.length} pages at ${r.viewports.join(" + ")} on ${r.baseUrl}${r.loggedIn === null ? "" : r.loggedIn ? " (logged in)" : " (login failed)"}`];
  if (r.candidates.length) l.push("", "problems (one line per root cause):");
  for (const c of r.candidates) l.push(`  ${c.kind}: ${c.example}  [${where(c.routes)}]`);
  const a11y = new Map<string, string[]>();
  for (const a of r.a11y) for (const v of a.violations) a11y.set(v.id, [...(a11y.get(v.id) ?? []), new URL(a.url).pathname]);
  if (a11y.size) l.push("", "accessibility (axe rules):");
  for (const [id, routes] of a11y) l.push(`  ${id}  [${where(routes)}]`);
  // Signals left for the agent to judge, deduplicated across pages.
  const other = new Map<string, Set<string>>();
  const note = (k: string, route: string) => other.set(k, (other.get(k) ?? new Set()).add(route));
  for (const v of r.visits) {
    for (const x of v.signals) if (x.kind === "overlap" || x.kind === "slow-lcp" || x.kind === "empty-page") note(`${x.kind}: ${x.detail}`, v.route);
    for (const e of v.consoleErrors) note(`console: ${e}`, v.route);
    if (v.error) note(`load error: ${v.error}`, v.route);
  }
  if (other.size) l.push("", "to judge yourself (not recorded):");
  for (const [k, routes] of other) l.push(`  ${k}  [${where([...routes])}]`);
  if (r.recorded.length) l.push("", `recorded: ${r.recorded.join(", ")}`);
  for (const s of r.skipped) l.push(`skipped: ${s}`);
  for (const w of r.warnings) l.push(`warning: ${w}`);
  return l.join("\n") + "\n";
}
