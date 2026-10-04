import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import type { Browser } from "playwright";
import { slugOf } from "./a11y.js";
import { launchChromium } from "./browser.js";
import { openSession, appState } from "./auth.js";
import { addFinding, listFindings } from "./findings.js";
import { recordVisit } from "./run.js";
import { wreckPaths, ensureDirs } from "./paths.js";
import { loadTarget, assertAllowedTarget, isExcluded, pagesOf, type Target } from "./context.js";
import { WreckError } from "./errors.js";
import type { FindingInput } from "./schema.js";

export type FormFactor = "mobile" | "desktop";

/** Google's "poor" lab thresholds. TBT stands in for INP, which needs real interactions. */
export const METRICS = [
  { id: "largest-contentful-paint", label: "LCP", what: "Largest content takes", poor: 4000, unit: "ms", devSensitive: true },
  { id: "cumulative-layout-shift", label: "CLS", what: "Layout shift score", poor: 0.25, unit: "", devSensitive: false },
  { id: "total-blocking-time", label: "TBT", what: "Main thread blocked for", poor: 600, unit: "ms", devSensitive: true },
] as const;

export interface PageMetric { label: string; value: number; display: string; poor: boolean }
export interface PageAudit { title: string; display?: string }
export interface PerfPage {
  route: string; url: string; score: number | null; metrics: PageMetric[];
  opportunities: PageAudit[]; failing: { category: string; title: string }[]; report?: string; error?: string;
}
export interface PerfResult {
  baseUrl: string; formFactor: FormFactor; devServer: boolean; loggedIn: boolean | null;
  pages: PerfPage[]; recorded: string[]; skipped: string[]; warnings: string[];
}

const fmt = (unit: string, v: number) => (unit === "ms" ? `${(v / 1000).toFixed(1)} s` : v.toFixed(2));

/** HTML markers that only development servers emit (Next.js, Vite, webpack HMR). */
export const isDevHtml = (html: string): boolean =>
  /\/@vite\/client|react-refresh|webpack-hmr|hmr-client|"buildId":"development"|\\?"b\\?":\\?"development\\?"|__nextjs_original-stack-frame/.test(html);

/** Summarize one Lighthouse result (LHR) into metrics, top opportunities and failing non-performance audits. */
export function summarizeLhr(lhr: any): Omit<PerfPage, "route" | "url"> {
  const metrics = METRICS.flatMap((m) => {
    const a = lhr.audits?.[m.id];
    if (typeof a?.numericValue !== "number") return [];
    return [{ label: m.label, value: a.numericValue, display: fmt(m.unit, a.numericValue), poor: a.numericValue > m.poor }];
  });
  const perfRefs: { id: string }[] = lhr.categories?.performance?.auditRefs ?? [];
  const opportunities = perfRefs
    .map((r) => lhr.audits?.[r.id])
    .filter((a) => a && a.details?.type === "opportunity" && typeof a.score === "number" && a.score < 0.9 && (a.details.overallSavingsMs ?? 0) >= 300)
    .sort((a, b) => (b.details.overallSavingsMs ?? 0) - (a.details.overallSavingsMs ?? 0))
    .slice(0, 3)
    .map((a) => ({ title: a.title, ...(a.displayValue ? { display: a.displayValue } : {}) }));
  const failing: { category: string; title: string }[] = [];
  for (const cat of ["best-practices", "seo"]) {
    for (const r of lhr.categories?.[cat]?.auditRefs ?? []) {
      const a = lhr.audits?.[r.id];
      if (a && a.scoreDisplayMode === "binary" && a.score === 0) failing.push({ category: cat, title: a.title });
    }
  }
  const s = lhr.categories?.performance?.score;
  return { score: typeof s === "number" ? Math.round(s * 100) : null, metrics, opportunities, failing };
}

function findingFor(p: PerfPage, m: PageMetric, ff: FormFactor): FindingInput {
  const spec = METRICS.find((x) => x.label === m.label)!;
  const device = ff === "mobile" ? "a mid-range phone on slow 4G" : "desktop";
  const fixes = p.opportunities.length ? ` Biggest savings: ${p.opportunities.map((o) => o.title + (o.display ? ` (${o.display})` : "")).join("; ")}.` : "";
  return {
    title: `${m.label} ${m.display} on ${p.route} (${ff})`,
    category: "performance", severity: m.label === "CLS" ? "medium" : m.value > spec.poor * 2 ? "high" : "medium",
    persona: "perf-scan", route: p.route,
    steps: [ff === "mobile" ? { action: "setViewport", width: 412, height: 823 } : { action: "setViewport", width: 1350, height: 940 }, { action: "goto", url: p.route }],
    assertions: [],
    expected: `${spec.label} within Google's "poor" threshold (${fmt(spec.unit, spec.poor)}) on ${device}`,
    actual: `${spec.what} ${m.display} on ${device} (Lighthouse performance score ${p.score ?? "n/a"}).${fixes}${p.report ? ` Report: ${p.report}` : ""}`,
    reproduced: false,
  };
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => { const port = (s.address() as { port: number }).port; s.close(() => res(port)); });
  });
}

// Full Chromium in new headless mode; Lighthouse does not support the headless shell.
const launchForLighthouse = (port: number): Promise<Browser> => launchChromium({ channel: "chromium", args: [`--remote-debugging-port=${port}`] });

async function loadLighthouse(): Promise<any> {
  try { return (await import("lighthouse")).default; }
  catch (e) { throw new WreckError(`Lighthouse could not be loaded (${(e as Error).message.split("\n")[0]}); it needs Node 22.19+. Run: npx @miyannishar/wreck-it setup`, 1); }
}

export interface PerfOptions { urls?: string[]; baseUrl?: string; formFactor?: FormFactor; maxPages?: number; record?: boolean; iOwnThis?: boolean; account?: string }
/** What every Lighthouse run in one `wreck-it perf` shares. */
interface MeasureEnv { lighthouse: any; port: number; ff: FormFactor; keepStorage: boolean; dir: string }

const failedPage = (route: string, url: string, error: string): PerfPage => ({ route, url, score: null, metrics: [], opportunities: [], failing: [], error });

/** The pages to measure: the ones given, else the discovered static pages (up to `maxPages`). */
function pickUrls(t: Target, opts: PerfOptions, warnings: string[]): string[] {
  if (opts.urls?.length) return opts.urls.map((u) => new URL(u, t.base).href);
  const statics = pagesOf(t.disc).filter((x) => !x.dynamic && !isExcluded(t.cfg, x.path, { api: true })).map((x) => x.path);
  if (!statics.length) warnings.push("no pages in .wreck-it/discovery.json; measuring / only (run `wreck-it discover` first)");
  const routes = [...new Set(statics.length ? statics : ["/"])];
  const max = opts.maxPages ?? 8;
  if (routes.length > max) warnings.push(`measuring the first ${max} of ${routes.length} pages; pass --max-pages to change`);
  return routes.slice(0, max).map((r) => new URL(r, t.base).href);
}

async function looksLikeDevServer(url: string): Promise<boolean> {
  try { return isDevHtml(await (await fetch(url, { signal: AbortSignal.timeout(15_000) })).text()); }
  catch { return false; /* Lighthouse reports the load error per page */ }
}

/** Log in as the configured account by putting its cookies into the browser Lighthouse drives. */
async function loginForLighthouse(browser: Browser, root: string, t: Target, account: string | undefined, warnings: string[]): Promise<{ loggedIn: boolean | null; keepStorage: boolean }> {
  if (!t.cfg.accounts.length) return { loggedIn: null, keepStorage: false };
  const session = await openSession(browser, root, t.base, pagesOf(t.disc).map((x) => x.path), account);
  warnings.push(...session.warnings.map((w) => w.replace("testing logged out", "measuring logged out")));
  if (!session.state) return { loggedIn: session.loggedIn, keepStorage: false };
  // Put the session into the default browser context Lighthouse uses. Unlike an extra Cookie header, the jar
  // sends it only to the app's own domain and keeps it out of the saved report.
  const { cookies } = appState(session.state, t.base);
  if (!cookies.length) {
    warnings.push("this app keeps its session in local storage, which Lighthouse can't load; measuring logged out");
    return { loggedIn: false, keepStorage: false };
  }
  const cdp = await browser.newBrowserCDPSession();
  await cdp.send("Storage.setCookies", { cookies: cookies.map(({ partitionKey: _p, ...c }: any) => c) as any });
  await cdp.detach().catch(() => {});
  warnings.push("measuring logged in: Lighthouse can't clear storage without logging out, so pages after the first load with a warm cache");
  return { loggedIn: session.loggedIn, keepStorage: true };
}

async function measurePage(env: MeasureEnv, url: string, save: boolean): Promise<PerfPage> {
  const route = new URL(url).pathname + new URL(url).search;
  try {
    const flags = {
      port: env.port, logLevel: "error", output: "html", onlyCategories: ["performance", "best-practices", "seo"],
      formFactor: env.ff, ...(env.keepStorage ? { disableStorageReset: true } : {}),
    };
    const config = env.ff === "desktop" ? (await import("lighthouse")).desktopConfig : undefined;
    const r = await env.lighthouse(url, flags, config);
    if (!r?.lhr) return failedPage(route, url, "Lighthouse returned no result");
    if (r.lhr.runtimeError) return failedPage(route, url, r.lhr.runtimeError.message);
    let report: string | undefined;
    if (save) {
      await mkdir(env.dir, { recursive: true });
      await writeFile(join(env.dir, `${slugOf(url)}-${env.ff}.html`), Array.isArray(r.report) ? r.report[0] : r.report);
      report = `.wreck-it/perf/${slugOf(url)}-${env.ff}.html`;
    }
    return { route, url, ...summarizeLhr(r.lhr), ...(report ? { report } : {}) };
  } catch (e) {
    return failedPage(route, url, (e as Error).message.split("\n")[0]!);
  }
}

/** Findings for poor metrics, each confirmed by a second run (lab metrics are noisy). Dev-server LCP and TBT are not recorded. */
async function recordPerf(root: string, env: MeasureEnv, pages: PerfPage[], devServer: boolean): Promise<{ recorded: string[]; skipped: string[] }> {
  const recorded: string[] = [], skipped: string[] = [];
  await ensureDirs(wreckPaths(root));
  const { findings: existing } = await listFindings(root);
  for (const page of pages) {
    const poor = page.metrics.filter((m) => m.poor && !(devServer && METRICS.find((x) => x.label === m.label)!.devSensitive));
    if (!poor.length) continue;
    const again = await measurePage(env, page.url, false);
    for (const m of poor) {
      const dup = existing.find((f) => f.persona === "perf-scan" && f.route === page.route && f.title.startsWith(`${m.label} `) && f.title.endsWith(`(${env.ff})`));
      if (dup) { skipped.push(`${dup.id} already records ${m.label} on ${page.route}`); continue; }
      const input = findingFor(page, m, env.ff);
      input.reproduced = again.metrics.some((x) => x.label === m.label && x.poor);
      const { finding } = await addFinding(root, input);
      existing.push(finding);
      recorded.push(finding.id);
    }
  }
  return { recorded, skipped };
}

export async function runPerf(root: string, opts: PerfOptions): Promise<PerfResult> {
  const t = await loadTarget(root, opts.baseUrl);
  const ff: FormFactor = opts.formFactor ?? "mobile";
  const warnings: string[] = [];
  const urls = pickUrls(t, opts, warnings);
  for (const u of urls) assertAllowedTarget(u, t.cfg, opts.iOwnThis);

  const devServer = await looksLikeDevServer(urls[0]!);
  if (devServer) warnings.push("this looks like a development server, which is much slower than a production build; LCP and TBT are listed but not recorded. For real numbers run a production build (e.g. `npm run build && npm start`) and re-run `wreck-it perf`");

  const lighthouse = await loadLighthouse();
  const port = await freePort();
  const browser = await launchForLighthouse(port);
  try {
    const { loggedIn, keepStorage } = await loginForLighthouse(browser, root, t, opts.account, warnings);
    const env: MeasureEnv = { lighthouse, port, ff, keepStorage, dir: t.p.perf };
    const pages: PerfPage[] = [];
    for (const url of urls) {
      const page = await measurePage(env, url, true);
      pages.push(page);
      if (page.error) warnings.push(`could not measure ${page.route}: ${page.error}`);
      else await recordVisit(root, page.route, "perf-scan");
    }
    const { recorded, skipped } = opts.record ? await recordPerf(root, env, pages, devServer) : { recorded: [], skipped: [] };
    const result: PerfResult = { baseUrl: t.base, formFactor: ff, devServer, loggedIn, pages, recorded, skipped, warnings };
    await ensureDirs(t.p);
    await mkdir(t.p.perf, { recursive: true });
    await writeFile(join(t.p.perf, `summary-${ff}.json`), JSON.stringify(result, null, 2));
    return result;
  } finally { await browser.close().catch(() => {}); }
}

export function formatPerf(r: PerfResult): string {
  const l = [`measured ${r.pages.length} page(s) on ${r.baseUrl} as ${r.formFactor}${r.devServer ? " (dev server)" : ""}${r.loggedIn === null ? "" : r.loggedIn ? " (logged in)" : " (login failed)"}`, ""];
  for (const p of r.pages) {
    if (p.error) { l.push(`  ${p.route}  error: ${p.error}`); continue; }
    const ms = p.metrics.map((m) => `${m.label} ${m.display}${m.poor ? " POOR" : ""}`).join("  ");
    l.push(`  ${p.route}  score ${p.score ?? "n/a"}  ${ms}${p.report ? `  → ${p.report}` : ""}`);
    for (const o of p.opportunities) l.push(`      fix: ${o.title}${o.display ? ` (${o.display})` : ""}`);
  }
  const failing = new Map<string, string[]>();
  for (const p of r.pages) for (const f of p.failing) failing.set(`${f.category}: ${f.title}`, [...(failing.get(`${f.category}: ${f.title}`) ?? []), p.route]);
  if (failing.size) l.push("", "to judge yourself (best practices / SEO, not recorded):");
  for (const [k, routes] of failing) l.push(`  ${k}  [${routes.length > 3 ? `${routes.length} pages` : routes.join(", ")}]`);
  if (r.recorded.length) l.push("", `recorded: ${r.recorded.join(", ")}`);
  for (const s of r.skipped) l.push(`skipped: ${s}`);
  for (const w of r.warnings) l.push(`warning: ${w}`);
  return l.join("\n") + "\n";
}
