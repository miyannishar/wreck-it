import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Page, type Response } from "playwright";
import { wreckPaths } from "./paths.js";
import { WreckError } from "./errors.js";
import { addFinding, listFindings, updateFinding } from "./findings.js";
import type { Severity } from "./schema.js";

export interface A11yNode { target: string; html: string; failureSummary: string }
export interface A11yViolation { id: string; impact: string; help: string; helpUrl: string; nodes: A11yNode[] }
export interface A11yResult { url: string; scannedAt: string; violations: A11yViolation[] }

export const slugOf = (url: string): string => {
  const u = new URL(url);
  return (u.host + u.pathname + u.search).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 100) || "page";
};

export function parseViewport(v: string): { width: number; height: number } {
  const m = /^(\d{2,5})x(\d{2,5})$/i.exec(v);
  if (!m) throw new WreckError(`invalid --viewport "${v}" (use WxH, e.g. 390x844)`, 2);
  return { width: Number(m[1]), height: Number(m[2]) };
}

export const severityOf = (impact: string): Severity => (impact === "critical" ? "high" : impact === "serious" ? "medium" : "low");

export async function launchBrowser(): Promise<Browser> {
  try { return await chromium.launch(); }
  catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("Executable doesn't exist")) throw new WreckError("Playwright Chromium is not installed; run: npx playwright install chromium", 1);
    throw e;
  }
}

/** Open a URL and wait for client-rendered content; pages that poll never reach idle, so the wait is capped. */
export async function openSettled(page: Page, url: string): Promise<Response | null> {
  const res = await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  return res;
}

/** Run axe-core on the page that is already loaded. */
export async function axeOnPage(page: Page, url: string): Promise<A11yResult> {
  await page.addScriptTag({ path: createRequire(import.meta.url).resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    // @ts-expect-error axe is injected into the page
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } });
    return r.violations.map((v: any) => ({
      id: v.id, impact: v.impact ?? "minor", help: v.help, helpUrl: v.helpUrl,
      nodes: v.nodes.slice(0, 10).map((n: any) => ({ target: n.target.join(" "), html: String(n.html).slice(0, 300), failureSummary: n.failureSummary ?? "" })),
      count: v.nodes.length,
    }));
  });
  return { url, scannedAt: new Date().toISOString(), violations: violations.map(({ count: _c, ...v }: any) => ({ ...v, nodeCount: _c })) };
}

export async function scanUrls(urls: string[], opts: { storageState?: string; viewport?: { width: number; height: number } }): Promise<A11yResult[]> {
  const browser = await launchBrowser();
  try {
    const ctx = await browser.newContext({ ...(opts.storageState ? { storageState: opts.storageState } : {}), ...(opts.viewport ? { viewport: opts.viewport } : {}) });
    const out: A11yResult[] = [];
    for (const url of urls) {
      const page = await ctx.newPage();
      try {
        await openSettled(page, url);
        out.push(await axeOnPage(page, url));
      } finally { await page.close().catch(() => {}); }
    }
    return out;
  } finally { await browser.close().catch(() => {}); }
}

export async function writeResult(root: string, r: A11yResult): Promise<string> {
  const dir = wreckPaths(root).a11y;
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${slugOf(r.url)}.json`);
  const clean = { url: r.url, scannedAt: r.scannedAt, violations: r.violations.map(({ id, impact, help, helpUrl, nodes }) => ({ id, impact, help, helpUrl, nodes })) };
  await writeFile(file, JSON.stringify(clean, null, 2));
  return file;
}

export async function recordViolations(root: string, r: A11yResult): Promise<string[]> {
  const route = new URL(r.url).pathname || "/";
  const ids: string[] = [];
  const { findings: existing } = await listFindings(root);
  for (const v of r.violations) {
    const n = (v as A11yViolation & { nodeCount?: number }).nodeCount ?? v.nodes.length;
    // One finding per axe rule across pages: a site-wide component (header, footer) would otherwise be filed once per URL.
    const prior = existing.find((f) => f.persona === "a11y-scan" && f.title.endsWith(`(${v.id})`));
    if (prior) {
      if (!prior.actual.includes(r.url)) {
        const updated = await updateFinding(root, prior.id, { actual: `${prior.actual}\nAlso on ${r.url} (${n} element${n === 1 ? "" : "s"}).` });
        prior.actual = updated.actual;
      }
      ids.push(prior.id);
      continue;
    }
    const { finding } = await addFinding(root, {
      title: `a11y: ${v.help} (${v.id})`.slice(0, 200),
      category: "accessibility", severity: severityOf(v.impact), persona: "a11y-scan", route,
      steps: [{ action: "goto", url: r.url }], assertions: [],
      expected: `${v.help} (WCAG/axe rule ${v.id}) satisfied on ${route}`,
      actual: `axe-core reports ${n} element${n === 1 ? "" : "s"} failing ${v.id} (${v.impact}), e.g. ${v.nodes[0]?.target ?? "n/a"}; see ${v.helpUrl}`,
      evidence: { screenshots: [], console: [], network: [] }, reproduced: true,
    });
    existing.push(finding);
    ids.push(finding.id);
  }
  return ids;
}
