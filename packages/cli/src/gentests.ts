import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { Assertion, Finding, Step, Target } from "./schema.js";
import { listFindings, writeAtomic } from "./findings.js";
import { loadConfig } from "./config.js";
import { authRel } from "./auth.js";
import { wreckPaths } from "./paths.js";

const S = (v: string): string => JSON.stringify(v);
const regexEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");
/** Make text safe inside a JSDoc block comment. */
const cmt = (s: string): string => s.replace(/\*\//g, "* /").replace(/\r?\n/g, "\n * ");

export function locatorCode(t: Target, opts: { first?: boolean } = {}): string {
  let base: string;
  switch (t.by) {
    case "role": {
      const o: string[] = [];
      if (t.name !== undefined) o.push(`name: ${S(t.name)}`);
      if (t.exact !== undefined) o.push(`exact: ${t.exact}`);
      base = `page.getByRole(${S(t.role)}${o.length ? `, { ${o.join(", ")} }` : ""})`;
      break;
    }
    case "label": base = `page.getByLabel(${S(t.value)})`; break;
    case "text": base = `page.getByText(${S(t.value)})`; break;
    case "placeholder": base = `page.getByPlaceholder(${S(t.value)})`; break;
    case "testId": base = `page.getByTestId(${S(t.value)})`; break;
    case "css": base = `page.locator(${S(t.value)})`; break;
  }
  return (opts.first ?? true) ? `${base}.first()` : base;
}

/** `{{unique}}` in a filled value becomes a per-run value, so sign-ups with fixed emails stay rerunnable. */
const valueCode = (v: string): string =>
  v.includes("{{unique}}") ? "`" + v.replace(/[`\\$]/g, "\\$&").split("{{unique}}").join("${Date.now()}") + "`" : S(v);

/** Client-rendered pages keep loading after navigation; wait (capped) so negated assertions can't pass on a half-rendered page. */
const SETTLE = `await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});`;
const SETTLES = new Set<Step["action"]>(["goto", "click", "press", "reload", "back", "forward"]);

/** Keep app URLs portable while preserving deliberate external destinations. */
function appUrl(url: string, baseUrl: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.origin === new URL(baseUrl).origin) return parsed.pathname + parsed.search + parsed.hash;
  } catch { /* already relative */ }
  return url;
}

function stepCode(s: Step, baseUrl: string): string {
  const code = stepAction(s, baseUrl);
  return SETTLES.has(s.action) ? `${code}\n  ${SETTLE}` : code;
}

function stepAction(s: Step, baseUrl: string): string {
  switch (s.action) {
    case "goto": return `await page.goto(${S(appUrl(s.url, baseUrl))});`;
    case "click": {
      const L = locatorCode(s.target);
      return s.count && s.count > 1 ? `await ${L}.click({ clickCount: ${s.count} });` : `await ${L}.click();`;
    }
    case "fill": return `await ${locatorCode(s.target)}.fill(${valueCode(s.value)});`;
    case "select": return `await ${locatorCode(s.target)}.selectOption(${S(s.value)});`;
    case "check": return `await ${locatorCode(s.target)}.check();`;
    case "uncheck": return `await ${locatorCode(s.target)}.uncheck();`;
    case "hover": return `await ${locatorCode(s.target)}.hover();`;
    case "press":
      return s.target ? `await ${locatorCode(s.target)}.press(${S(s.key)});` : `await page.keyboard.press(${S(s.key)});`;
    case "wait": return `await page.waitForTimeout(${s.ms});`;
    case "waitFor": return `await ${locatorCode(s.target)}.waitFor({ state: ${S(s.state)} });`;
    case "reload": return `await page.reload();`;
    case "back": return `await page.goBack();`;
    case "forward": return `await page.goForward();`;
    case "setOffline": return `await context.setOffline(${s.offline});`;
    case "setViewport": return `await page.setViewportSize({ width: ${s.width}, height: ${s.height} });`;
    case "http": {
      const o = [`method: ${S(s.method)}`];
      if (s.headers !== undefined) o.push(`headers: ${JSON.stringify(s.headers)}`);
      if (s.body !== undefined) o.push(`data: ${valueCode(s.body)}`);
      // page.request shares the page's cookies, so requests after login steps are authenticated.
      return `res = await page.request.fetch(${S(appUrl(s.url, baseUrl))}, { ${o.join(", ")} });`;
    }
  }
}

function assertionCode(a: Assertion): string {
  switch (a.kind) {
    case "visible": return `await expect(${locatorCode(a.target)}).toBeVisible();`;
    case "hidden": return `await expect(${locatorCode(a.target)}).toBeHidden();`;
    case "text": return `await expect(${locatorCode(a.target)})${a.negate ? ".not" : ""}.toContainText(${S(a.contains)});`;
    case "value": return `await expect(${locatorCode(a.target)}).toHaveValue(${S(a.equals)});`;
    case "textMatches": return `await expect(${locatorCode(a.target)})${a.negate ? ".not" : ""}.toContainText(new RegExp(${S(a.pattern)}));`;
    case "imageLoaded": return `await expect(${locatorCode(a.target)}).toBeVisible();\n  await expect.poll(() => ${locatorCode(a.target)}.evaluate((el) => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0)).toBe(true);`;
    case "linkResolves": return `{\n    const link = ${locatorCode(a.target)};\n    await expect(link).toBeVisible();\n    const href = await link.getAttribute("href");\n    expect(href, "link has a destination").toBeTruthy();\n    const response = await page.request.get(new URL(href!, page.url()).href);\n    expect(response.status(), "rendered link resolves").toBeLessThan(400);\n  }`;
    case "url": return `await expect(page).toHaveURL(new RegExp(${S(regexEscape(a.contains))}));`;
    case "count": return `await expect(${locatorCode(a.target, { first: false })}).toHaveCount(${a.equals});`;
    case "noConsoleErrors": return `expect(consoleErrors).toEqual([]);`;
    case "noServerErrors": return `expect(serverErrors).toEqual([]);`;
    case "httpStatus":
      return a.equals !== undefined ? `expect(res?.status()).toBe(${a.equals});`
        : a.atLeast !== undefined ? `expect(res!.status()).toBeGreaterThanOrEqual(${a.atLeast});`
        : `expect(res!.status()).toBeLessThan(${a.below ?? 500});`;
  }
}

function sourceLine(f: Finding): string {
  const s = f.source;
  if (!s) return "Source: not traced";
  if (s.confidence === "low") return cmt(`Likely in: ${s.candidates.join(", ")} — ${s.why}`);
  return cmt(`Source: ${s.file}:${s.line} — ${s.why}`);
}

/** Env var that overrides a label's session file, e.g. WRECK_IT_AUTH_MAIN for "main" (CI keeps sessions elsewhere). */
export const authEnv = (label: string) => `WRECK_IT_AUTH_${label.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;

export function renderSpec(f: Finding, baseUrl: string, authFile?: string): string {
  const fixme = f.assertions.length === 0;
  const lines = [
    `// Generated by wreck-it. Re-run \`npx @miyannishar/wreck-it gen-tests\` to regenerate.`,
    `import { test, expect } from "@playwright/test";`,
    ``,
    f.auth
      ? `test.use({ baseURL: process.env.WRECK_IT_BASE_URL ?? ${S(baseUrl)}, storageState: process.env.${authEnv(f.auth)} ?? ${S(authFile ?? authRel(f.auth))} });`
      : `test.use({ baseURL: process.env.WRECK_IT_BASE_URL ?? ${S(baseUrl)} });`,
    ``,
    `/**`,
    ` * ${cmt(`${f.id} [${f.severity} · ${f.category}] ${f.title}`)}`,
    ` * Expected: ${cmt(f.expected)}`,
    ` * Actual (bug): ${cmt(f.actual)}`,
    ` * ${sourceLine(f)}`,
    ` */`,
  ];
  if (fixme) lines.push(`// TODO(wreck-it): add an assertion describing the correct behavior`);
  lines.push(
    `${fixme ? "test.fixme" : "test"}(${S(`${f.id}: ${f.title}`)}, async ({ page, context }) => {`,
    `  const consoleErrors: string[] = [];`,
    `  const serverErrors: string[] = [];`,
    `  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });`,
    `  page.on("pageerror", (e) => consoleErrors.push(e.message));`,
    "  page.on(\"response\", (r) => { if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`); });",
    `  let res: Awaited<ReturnType<typeof page.request.fetch>> | undefined;`,
    ``,
    ...f.steps.map((s) => `  ${stepCode(s, baseUrl)}`),
    ``,
    ...f.assertions.map((a) => `  ${assertionCode(a)}`),
    `});`,
    ``,
  );
  return lines.join("\n");
}

async function resolveBaseUrl(root: string): Promise<string> {
  const cfg = await loadConfig(root);
  if (cfg.baseUrl) return cfg.baseUrl;
  try {
    const d = JSON.parse(await readFile(wreckPaths(root).discovery, "utf8")) as { baseUrl?: unknown };
    if (typeof d.baseUrl === "string" && d.baseUrl) return d.baseUrl;
  } catch { /* discovery.json absent or unreadable */ }
  return "http://localhost:3000";
}

export async function genTests(root: string, opts: { force?: boolean } = {}): Promise<{ written: string[]; preserved: string[]; skipped: { id: string; reason: string }[]; scaffoldedConfig: boolean; warnings: string[] }> {
  const baseUrl = await resolveBaseUrl(root);
  const { accounts } = await loadConfig(root);
  const authWarnings = new Set<string>();
  const { findings, errors } = await listFindings(root);
  const dir = wreckPaths(root).testsDir;
  const manifestFile = join(wreckPaths(root).dir, "generated-tests.json");
  const hash = (text: string) => createHash("sha256").update(text).digest("hex");
  let previous: Record<string, string> = {};
  const warnings = errors.map((e) => `skipped ${e.file}: ${e.message}`);
  if (existsSync(manifestFile)) {
    try {
      const saved = JSON.parse(await readFile(manifestFile, "utf8"));
      if (saved.version !== 1 || !saved.files || typeof saved.files !== "object" || Array.isArray(saved.files)
        || Object.entries(saved.files).some(([name, digest]) => !/^WR-\d{3,}\.spec\.ts$/.test(name) || typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest))) throw new Error("invalid manifest");
      previous = saved.files;
    } catch { warnings.push("generated-tests.json is unreadable; existing specs will be preserved unless --force is supplied"); }
  }
  const next: Record<string, string> = {};
  const written: string[] = [];
  const preserved: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  const eligible = new Set(findings.filter((f) => f.reproduced && f.category !== "performance").map((f) => `${f.id}.spec.ts`));
  const preserve = (file: string) => {
    preserved.push(file);
    warnings.push(`preserved ${file}: edited or untracked spec; reconcile it with the finding, or use gen-tests --force to replace it`);
  };
  if (existsSync(dir)) {
    for (const name of await readdir(dir)) {
      if (!/^WR-\d{3,}\.spec\.ts$/.test(name) || eligible.has(name)) continue;
      const file = join(dir, name);
      if (opts.force || previous[name] === hash(await readFile(file, "utf8"))) await unlink(file);
      else { preserve(file); if (previous[name]) next[name] = previous[name]; }
    }
  }
  for (const f of findings) {
    if (!f.reproduced) { skipped.push({ id: f.id, reason: "not reproduced" }); continue; }
    if (f.category === "performance") { skipped.push({ id: f.id, reason: "load findings have no browser repro" }); continue; }
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${f.id}.spec.ts`);
    const name = `${f.id}.spec.ts`;
    const authFile = f.auth ? accounts.find((a) => a.label === f.auth)?.storageState ?? authRel(f.auth) : undefined;
    if (authFile && !existsSync(join(root, authFile))) authWarnings.add(`${f.id} starts logged in as "${f.auth}", but ${authFile} doesn't exist yet; run \`wreck-it login --label ${f.auth}\` (or set ${authEnv(f.auth!)} in CI)`);
    const rendered = renderSpec(f, baseUrl, authFile);
    if (existsSync(file) && !opts.force) {
      const current = await readFile(file, "utf8");
      if (hash(current) !== previous[name] && current !== rendered) {
        preserve(file);
        if (previous[name]) next[name] = previous[name];
        continue;
      }
    }
    await writeAtomic(file, rendered);
    next[name] = hash(rendered);
    written.push(file);
  }
  await mkdir(wreckPaths(root).dir, { recursive: true });
  await writeAtomic(manifestFile, JSON.stringify({ version: 1, files: next }, null, 2) + "\n");
  let scaffoldedConfig = false;
  const hasConfig = ["ts", "js", "mjs", "cjs"].some((e) => existsSync(join(root, `playwright.config.${e}`)));
  if (!hasConfig) {
    await writeAtomic(
      join(root, "playwright.config.ts"),
      `import { defineConfig } from "@playwright/test";\nexport default defineConfig({\n  testDir: "./tests/wreck-it",\n  use: { baseURL: process.env.WRECK_IT_BASE_URL ?? ${S(baseUrl)} },\n});\n`,
    );
    scaffoldedConfig = true;
  }
  return { written, preserved, skipped, scaffoldedConfig, warnings: [...warnings, ...authWarnings] };
}
