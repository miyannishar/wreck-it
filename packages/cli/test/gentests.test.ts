import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { locatorCode, renderSpec, genTests } from "../src/gentests.js";
import { addFinding } from "../src/findings.js";
import { tmpRoot, runCli } from "./helpers.js";
import { sample } from "./fixtures.js";

describe("gen-tests", () => {
  it("locators", () => {
    expect(locatorCode({ by: "role", role: "button", name: "Apply" })).toBe(`page.getByRole("button", { name: "Apply" }).first()`);
    expect(locatorCode({ by: "label", value: `Say "hi"` })).toBe(`page.getByLabel("Say \\"hi\\"").first()`);
    expect(locatorCode({ by: "css", value: "#x" }, { first: false })).toBe(`page.locator("#x")`);
  });
  it("renders steps and assertions; neutralizes comment terminators", async () => {
    const root = await tmpRoot();
    const { finding } = await addFinding(root, sample({
      title: "Bad */ title", reproduced: true,
      steps: [
        { action: "goto", url: "/cart" },
        { action: "fill", target: { by: "label", value: "Qty" }, value: "-1" },
        { action: "click", target: { by: "role", role: "button", name: "Pay" }, count: 2 },
        { action: "setOffline", offline: true },
        { action: "http", method: "GET", url: "/api/x" },
      ],
      assertions: [
        { kind: "text", target: { by: "testId", value: "total" }, contains: "$20" },
        { kind: "httpStatus", equals: 200 },
        { kind: "url", contains: "/orders?id=1" },
        { kind: "count", target: { by: "role", role: "listitem" }, equals: 1 },
      ],
    }));
    const code = renderSpec(finding, "http://localhost:3000");
    expect(code).toContain(`await page.getByLabel("Qty").first().fill("-1");`);
    expect(code).toContain(`await page.getByRole("button", { name: "Pay" }).first().click({ clickCount: 2 });`);
    expect(code).toContain(`await context.setOffline(true);`);
    expect(code).toContain(`res = await request.fetch("/api/x", { method: "GET" });`);
    expect(code).toContain(`await expect(page.getByTestId("total").first()).toContainText("$20");`);
    expect(code).toContain(`expect(res?.status()).toBe(200);`);
    expect(code).toContain(`await expect(page).toHaveURL(new RegExp("\\\\/orders\\\\?id=1"));`);
    expect(code).toContain(`await expect(page.getByRole("listitem")).toHaveCount(1);`);
    expect(code).toContain("Bad * / title");
    expect(code).toContain(`test("WR-001: Bad */ title"`);
    const arg = /new RegExp\((.*)\)\)/.exec(code)![1]!;
    expect(new RegExp(eval(arg)).test("http://x/orders?id=1")).toBe(true);
    expect(new RegExp(eval(arg)).test("http://x/ordersXid=1")).toBe(false);
  });
  it("uses test.fixme when there are no assertions", async () => {
    const root = await tmpRoot();
    const { finding } = await addFinding(root, sample({ reproduced: true }));
    const code = renderSpec(finding, "http://localhost:3000");
    expect(code).toMatch(/test\.fixme\(/);
    expect(code).toContain("// TODO(wreck-it): add an assertion describing the correct behavior");
  });
  it("renders source lines by confidence", async () => {
    const root = await tmpRoot();
    const hi = (await addFinding(root, sample({ source: { file: "app/a.ts", line: 3, why: "bad", confidence: "high" } }))).finding;
    const lo = (await addFinding(root, sample({ source: { candidates: ["a.ts", "b.ts"], why: "maybe", confidence: "low" } }))).finding;
    const none = (await addFinding(root, sample())).finding;
    expect(renderSpec(hi, "http://x")).toContain(" * Source: app/a.ts:3 — bad");
    expect(renderSpec(lo, "http://x")).toContain(" * Likely in: a.ts, b.ts — maybe");
    expect(renderSpec(none, "http://x")).toContain(" * Source: not traced");
  });
  it("genTests writes eligible files, skips others, scaffolds config once, removes stale specs", async () => {
    const root = await tmpRoot();
    await mkdir(join(root, "tests", "wreck-it"), { recursive: true });
    await writeFile(join(root, "tests", "wreck-it", "WR-099.spec.ts"), "stale");
    await writeFile(join(root, "tests", "wreck-it", "helper.ts"), "keep");
    await addFinding(root, sample({ reproduced: true, assertions: [{ kind: "noServerErrors" }] }));
    await addFinding(root, sample({ reproduced: false }));
    await addFinding(root, sample({ reproduced: true, category: "performance" }));
    const r = await genTests(root);
    expect(r.written.map((p) => p.split("/").pop())).toEqual(["WR-001.spec.ts"]);
    expect(r.skipped.map((s) => s.id)).toEqual(["WR-002", "WR-003"]);
    expect(r.scaffoldedConfig).toBe(true);
    expect(existsSync(join(root, "tests", "wreck-it", "WR-099.spec.ts"))).toBe(false);
    expect(existsSync(join(root, "tests", "wreck-it", "helper.ts"))).toBe(true);
    expect(await readFile(join(root, "playwright.config.ts"), "utf8")).toContain("WRECK_IT_BASE_URL");
    expect((await genTests(root)).scaffoldedConfig).toBe(false);
  });
  it("returns warnings for corrupt findings", async () => {
    const root = await tmpRoot();
    await addFinding(root, sample({ reproduced: true }));
    await writeFile(join(root, ".wreck-it", "findings", "WR-009.json"), "{broken");
    const r = await genTests(root);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/skipped .*WR-009\.json: /);
  });
  it("CLI prints warnings to stderr and the playwright hint to stdout", async () => {
    const root = await tmpRoot();
    await addFinding(root, sample({ reproduced: true }));
    await writeFile(join(root, ".wreck-it", "findings", "WR-009.json"), "{broken");
    const r = await runCli(["gen-tests", "--root", root]);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/warning: skipped .*WR-009\.json/);
    expect(r.stdout).toContain("Run them with: npx playwright test tests/wreck-it  (needs @playwright/test: npm i -D @playwright/test)");
  });
  it("uses discovery.json baseUrl when config has none", async () => {
    const root = await tmpRoot();
    await mkdir(join(root, ".wreck-it"), { recursive: true });
    await writeFile(join(root, ".wreck-it", "discovery.json"), JSON.stringify({ baseUrl: "http://localhost:4321" }));
    await addFinding(root, sample({ reproduced: true }));
    const r = await genTests(root);
    expect(await readFile(r.written[0]!, "utf8")).toContain("http://localhost:4321");
  });
});

describe("renderSpec settle waits", () => {
  it("waits for the network to settle after navigation and clicks, not after fills", () => {
    const f = {
      id: "WR-009", title: "t", category: "oddity", severity: "low", persona: "p", route: "/", createdAt: "x", reproduced: true,
      steps: [{ action: "goto", url: "/products" }, { action: "fill", target: { by: "label", value: "Q" }, value: "1" }, { action: "click", target: { by: "text", value: "Go" } }],
      assertions: [{ kind: "text", target: { by: "css", value: "body" }, contains: "undefined", negate: true }],
      expected: "e", actual: "a", evidence: { screenshots: [], console: [], network: [] },
    } as any;
    const code = renderSpec(f, "http://localhost:3000");
    expect(code.match(/waitForLoadState\("networkidle"/g)).toHaveLength(2);
    expect(code.indexOf('page.goto("/products")')).toBeLessThan(code.indexOf("waitForLoadState"));
  });
});
