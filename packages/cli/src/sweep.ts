import { readFile } from "node:fs/promises";
import type { BrowserContext, Page } from "playwright";
import { ODDITY_SCRIPT } from "./oddity.js";
import { launchBrowser, openSettled, axeOnPage, recordViolations, writeResult, parseViewport, type A11yResult } from "./a11y.js";
import { addFinding, listFindings, writeAtomic } from "./findings.js";
import { recordVisit } from "./run.js";
import { loadConfig } from "./config.js";
import { wreckPaths, ensureDirs } from "./paths.js";
import { isAllowedTarget } from "./target.js";
import { WreckError } from "./errors.js";
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

const NAV_AWAY = /(^|\/)(log-?out|sign-?out)(\/|$)/i;
const patternRe = (p: string) => new RegExp("^" + p.split("/").map((s) => (/^\[.+\]$/.test(s) ? "[^/]+" : s.replace(/[.*+?^${}()|\\]/g, "\\$&"))).join("/") + "$");

async function readJson(file: string): Promise<any> {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return undefined; }
}

/** Best-effort generic login: email/username + password + Enter on the app's login page. */
async function login(ctx: BrowserContext, base: string, pages: string[], acct: { email: string; password: string }): Promise<boolean> {
  const path = pages.find((p) => /(^|\/)(log-?in|sign-?in)$/i.test(p)) ?? "/login";
  const page = await ctx.newPage();
  try {
    await openSettled(page, new URL(path, base).href);
    const user = page.locator('input[type="email"], input[name*="email" i], input[name*="user" i], input[id*="email" i]').first();
    const pass = page.locator('input[type="password"]').first();
    if (!(await user.count()) || !(await pass.count())) return false;
    await user.fill(acct.email);
    await pass.fill(acct.password);
    await pass.press("Enter");
    await page.waitForURL((u) => u.pathname !== path, { timeout: 8_000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    return new URL(page.url()).pathname !== path || !(await page.locator('input[type="password"]').count());
  } catch { return false; }
  finally { await page.close().catch(() => {}); }
}

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

function findingFor(c: Candidate, base: string): FindingInput {
  const others = [...c.routes].filter((r) => r !== c.route);
  const also = others.length ? ` Also on: ${others.slice(0, 8).join(", ")}${others.length > 8 ? ", …" : ""}.` : "";
  const open = [{ action: "setViewport" as const, width: c.width, height: c.height }, { action: "goto" as const, url: c.route }];
  const common = { persona: "sweep", route: c.route, reproduced: false };
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

export async function runSweep(root: string, opts: { baseUrl?: string; viewports?: string; record?: boolean; iOwnThis?: boolean; a11y?: boolean }): Promise<SweepResult> {
  const p = wreckPaths(root);
  const cfg = await loadConfig(root);
  const disc = await readJson(p.discovery);
  const base = opts.baseUrl ?? cfg.baseUrl ?? disc?.baseUrl ?? "http://localhost:3000";
  const chk = isAllowedTarget(base, { iOwnThis: opts.iOwnThis || cfg.iOwnThis });
  if (!chk.ok) throw new WreckError(chk.reason, 3);
  const origin = new URL(base).origin;
  const vps = (opts.viewports ?? "1280x800,390x844").split(",").map((v) => v.trim()).filter(Boolean);
  const sizes = vps.map(parseViewport);
  const warnings: string[] = [];

  const all: { path: string; dynamic: boolean }[] = Array.isArray(disc?.pages) ? disc.pages : [];
  if (!all.length) warnings.push("no pages in .wreck-it/discovery.json; sweeping / only (run `wreck-it discover` first)");
  const excluded = (r: string) => NAV_AWAY.test(r) || r.startsWith("/api/") || cfg.exclude.some((x) => r === x || r.startsWith(x.endsWith("/") ? x : x + "/"));
  const statics = all.filter((x) => !x.dynamic && !excluded(x.path)).map((x) => x.path);
  const dynamics = all.filter((x) => x.dynamic && !excluded(x.path)).map((x) => x.path);
  const routes: string[] = statics.length ? [...new Set(statics)] : ["/"];

  const browser = await launchBrowser();
  const visits: Visit[] = [];
  const a11y: A11yResult[] = [];
  const cands = new Map<string, Candidate>();
  let loggedIn: boolean | null = null;
  try {
    let storageState: Awaited<ReturnType<BrowserContext["storageState"]>> | undefined;
    if (cfg.accounts[0]) {
      const lctx = await browser.newContext();
      loggedIn = await login(lctx, base, routes, cfg.accounts[0]);
      if (loggedIn) storageState = await lctx.storageState();
      else warnings.push(`could not log in as ${cfg.accounts[0].label}; sweeping logged out`);
      await lctx.close();
    }
    const newCtx = (vp: { width: number; height: number }) => browser.newContext({ viewport: vp, ...(storageState ? { storageState } : {}) });

    for (const [i, vp] of sizes.entries()) {
      const ctx = await newCtx(vp);
      const queue = [...routes];
      const pending = new Set(dynamics);
      for (let k = 0; k < queue.length; k++) {
        const route = queue[k]!;
        const url = new URL(route, base).href;
        const page = await ctx.newPage();
        const r = await visit(page, url, origin);
        // Fill dynamic routes (e.g. /products/[id]) with the first matching link we find.
        for (const pat of [...pending]) {
          const hit = r.links.map((l) => new URL(l).pathname).find((path) => patternRe(pat).test(path) && !queue.includes(path));
          if (hit) { queue.push(hit); pending.delete(pat); }
        }
        if (i === 0 && opts.a11y !== false && !r.error) {
          try { a11y.push(await axeOnPage(page, url)); } catch (e) { warnings.push(`axe failed on ${route}: ${(e as Error).message.split("\n")[0]}`); }
        }
        await page.close().catch(() => {});
        const { links: _l, ...v } = r;
        visits.push({ route, viewport: vps[i]!, ...v });
        if (r.error) { warnings.push(`could not load ${route} at ${vps[i]}: ${r.error}`); continue; }
        await recordVisit(root, route, "sweep");
        for (const c of candidatesOf(v, route, url, vp.width, vp.height)) {
          const prev = cands.get(c.key);
          if (prev) prev.routes.add(route); else cands.set(c.key, c);
        }
      }
      for (const pat of pending) if (i === 0) warnings.push(`no link found for dynamic route ${pat}; not swept`);
      await ctx.close();
    }

    const recorded: string[] = [], skipped: string[] = [];
    if (opts.record) {
      await ensureDirs(p);
      const { findings: existing } = await listFindings(root);
      for (const c of cands.values()) {
        const input = findingFor(c, base);
        const dup = existing.find((f) => f.persona === "sweep" && f.title === input.title);
        if (dup) { skipped.push(`${dup.id} already records: ${input.title}`); continue; }
        // Reproduce in a fresh context before trusting it.
        const ctx = await newCtx({ width: c.width, height: c.height });
        const page = await ctx.newPage();
        const again = await visit(page, c.url, origin);
        await ctx.close();
        input.reproduced = candidatesOf(again, c.route, c.url, c.width, c.height).some((x) => x.key === c.key);
        const { finding } = await addFinding(root, input);
        recorded.push(finding.id);
      }
      for (const r of a11y) recorded.push(...(await recordViolations(root, r)));
      for (const r of a11y) await writeResult(root, r);
    }
    const result: SweepResult = {
      baseUrl: base, loggedIn, viewports: vps, pages: [...new Set(visits.map((v) => v.route))], visits, a11y,
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
