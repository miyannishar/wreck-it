import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
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

function stepCode(s: Step): string {
  const code = stepAction(s);
  return SETTLES.has(s.action) ? `${code}\n  ${SETTLE}` : code;
}

function stepAction(s: Step): string {
  switch (s.action) {
    case "goto": return `await page.goto(${S(s.url)});`;
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
      return `res = await page.request.fetch(${S(s.url)}, { ${o.join(", ")} });`;
    }
  }
}

function assertionCode(a: Assertion): string {
  switch (a.kind) {
    case "visible": return `await expect(${locatorCode(a.target)}).toBeVisible();`;
    case "hidden": return `await expect(${locatorCode(a.target)}).toBeHidden();`;
    case "text": return `await expect(${locatorCode(a.target)})${a.negate ? ".not" : ""}.toContainText(${S(a.contains)});`;
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
    ...f.steps.map((s) => `  ${stepCode(s)}`),
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

export async function genTests(root: string): Promise<{ written: string[]; skipped: { id: string; reason: string }[]; scaffoldedConfig: boolean; warnings: string[] }> {
  const baseUrl = await resolveBaseUrl(root);
  const { accounts } = await loadConfig(root);
  const authWarnings = new Set<string>();
  const { findings, errors } = await listFindings(root);
  const dir = wreckPaths(root).testsDir;
  if (existsSync(dir)) {
    for (const n of await readdir(dir)) if (/^WR-.*\.spec\.ts$/.test(n)) await unlink(join(dir, n));
  }
  const written: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const f of findings) {
    if (!f.reproduced) { skipped.push({ id: f.id, reason: "not reproduced" }); continue; }
    if (f.category === "performance") { skipped.push({ id: f.id, reason: "load findings have no browser repro" }); continue; }
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${f.id}.spec.ts`);
    const authFile = f.auth ? accounts.find((a) => a.label === f.auth)?.storageState ?? authRel(f.auth) : undefined;
    if (authFile && !existsSync(join(root, authFile))) authWarnings.add(`${f.id} starts logged in as "${f.auth}", but ${authFile} doesn't exist yet; run \`wreck-it login --label ${f.auth}\` (or set ${authEnv(f.auth!)} in CI)`);
    await writeAtomic(file, renderSpec(f, baseUrl, authFile));
    written.push(file);
  }
  let scaffoldedConfig = false;
  const hasConfig = ["ts", "js", "mjs", "cjs"].some((e) => existsSync(join(root, `playwright.config.${e}`)));
  if (!hasConfig) {
    await writeAtomic(
      join(root, "playwright.config.ts"),
      `import { defineConfig } from "@playwright/test";\nexport default defineConfig({\n  testDir: "./tests/wreck-it",\n  use: { baseURL: process.env.WRECK_IT_BASE_URL ?? ${S(baseUrl)} },\n});\n`,
    );
    scaffoldedConfig = true;
  }
  return { written, skipped, scaffoldedConfig, warnings: [...errors.map((e) => `skipped ${e.file}: ${e.message}`), ...authWarnings] };
}
