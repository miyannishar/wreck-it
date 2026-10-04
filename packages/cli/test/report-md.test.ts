import { describe, it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { addFinding } from "../src/findings.js";
import { setStage, recordVisit } from "../src/run.js";
import { buildReportData } from "../src/report/data.js";
import { renderMarkdown } from "../src/report/markdown.js";
import { describeStep } from "../src/report/describe.js";
import { tmpRoot } from "./helpers.js";
import { sample } from "./fixtures.js";

describe("report data + markdown", () => {
  it("renders an empty project without crashing", async () => {
    const md = renderMarkdown(await buildReportData(await tmpRoot()));
    expect(md).toContain("**Readiness: 100/100 — Ship it**");
    expect(md).toContain("_No confirmed findings._");
    expect(md).toContain("Run incomplete: normal, explore, chaos, load did not finish");
  });
  it("sorts by severity, separates unconfirmed, picks fixFirst", async () => {
    const root = await tmpRoot();
    await addFinding(root, sample({ title: "Low thing", severity: "low", reproduced: true }));
    await addFinding(root, sample({ title: "Critical thing", severity: "critical", reproduced: true }));
    await addFinding(root, sample({ title: "Maybe flaky", reproduced: false }));
    const d = await buildReportData(root);
    expect(d.confirmed.map((f) => f.title)).toEqual(["Critical thing", "Low thing"]);
    expect(d.unconfirmed.map((f) => f.title)).toEqual(["Maybe flaky"]);
    const md = renderMarkdown(d);
    expect(md).toContain("Fix this first: WR-002 Critical thing");
    expect(md.indexOf("### CRITICAL")).toBeLessThan(md.indexOf("### LOW"));
    expect(md).toContain("## Unconfirmed / flaky");
  });
  it("includes coverage and load results; warns on corrupt files", async () => {
    const root = await tmpRoot();
    await setStage(root, "normal", "done");
    await recordVisit(root, "/cart", "normal-user");
    await mkdir(join(root, ".wreck-it", "load"), { recursive: true });
    await writeFile(join(root, ".wreck-it", "load", "bad.json"), "{");
    await writeFile(join(root, ".wreck-it", "discovery.json"), JSON.stringify({ pages: [{ path: "/cart" }, { path: "/about" }] }));
    await writeFile(join(root, ".wreck-it", "load", "ok.json"), JSON.stringify({
      url: "http://localhost:3000/api/x", method: "GET", profile: "ramp", startedAt: "t",
      phases: [{ label: "ramp-10", connections: 10, durationSec: 1, requests: 100, rps: 100, latency: { p50: 5, p90: 9, p99: 20, max: 30 }, errors: 0, timeouts: 0, non2xx: 0, errorRate: 0 }],
      breakingPoint: null, crashed: false, recovered: null, memory: null,
    }));
    const d = await buildReportData(root);
    expect(d.coverage.unvisitedRoutes).toEqual(["/about"]);
    expect(d.load).toHaveLength(1);
    expect(d.warnings.some((w) => w.includes("bad.json"))).toBe(true);
    const md = renderMarkdown(d);
    expect(md).toContain("## Load testing");
    expect(md).toContain("No breaking point found up to 10 connections");
    expect(md).toContain("Routes visited: 1/2");
  });
  it("low-confidence sources render as candidates", async () => {
    const root = await tmpRoot();
    await addFinding(root, sample({ reproduced: true, source: { why: "maybe here", confidence: "low", candidates: ["a.ts", "b.ts"] } }));
    expect(renderMarkdown(await buildReportData(root))).toContain("**Likely in:** `a.ts`, `b.ts` — maybe here");
  });
  it("warns on corrupt findings and missing screenshots", async () => {
    const root = await tmpRoot();
    await addFinding(root, sample({ reproduced: true, evidence: { screenshots: ["gone.png"] } }));
    await writeFile(join(root, ".wreck-it", "findings", "WR-050.json"), "{bad");
    const d = await buildReportData(root);
    expect(d.warnings.some((w) => w.startsWith("skipped corrupt finding:") && w.includes("WR-050.json"))).toBe(true);
    expect(d.warnings).toContain("missing screenshot for WR-001: ../gone.png");
  });
  it("describes steps", () => {
    expect(describeStep({ action: "click", target: { by: "role", role: "button", name: "Pay" }, count: 2 })).toBe('Click the button "Pay" ×2');
    expect(describeStep({ action: "fill", target: { by: "label", value: "Qty" }, value: "-1" })).toBe('Type "-1" into the field labelled "Qty"');
  });

  const goodLoad = (over: Record<string, unknown> = {}) => ({
    url: "http://localhost:3000/api/x", method: "GET", profile: "ramp", startedAt: "t",
    phases: [{ label: "ramp-10", connections: 10, durationSec: 1, requests: 100, rps: 100, latency: { p50: 5, p90: 9, p99: 20, max: 30 }, errors: 0, timeouts: 0, non2xx: 0, errorRate: 0 }],
    breakingPoint: null, crashed: false, recovered: null, memory: null, ...over,
  });
  it("skips structurally invalid load files with a warning", async () => {
    const root = await tmpRoot();
    await mkdir(join(root, ".wreck-it", "load"), { recursive: true });
    await writeFile(join(root, ".wreck-it", "load", "a.json"), JSON.stringify({ phases: [{}] }));
    await writeFile(join(root, ".wreck-it", "load", "b.json"), JSON.stringify(goodLoad({ method: undefined })));
    const d = await buildReportData(root);
    expect(d.load).toHaveLength(0);
    expect(d.warnings).toContain("unreadable load result: a.json");
    expect(d.warnings).toContain("unreadable load result: b.json");
    expect(() => renderMarkdown(d)).not.toThrow();
  });
  it("tolerates a run.json of {}", async () => {
    const root = await tmpRoot();
    await mkdir(join(root, ".wreck-it"), { recursive: true });
    await writeFile(join(root, ".wreck-it", "run.json"), "{}");
    const d = await buildReportData(root);
    expect(d.coverage.stages.normal).toBe("not run");
  });
  it("renders breaking point, crash and memory lines", async () => {
    const root = await tmpRoot();
    await mkdir(join(root, ".wreck-it", "load"), { recursive: true });
    await writeFile(join(root, ".wreck-it", "load", "x.json"), JSON.stringify(goodLoad({
      breakingPoint: { connections: 50, reason: "p99 > 2000ms" }, crashed: true, recovered: false,
      memory: { samples: [], slopeMbPerMin: 3.5, leakSuspected: true },
    })));
    const md = renderMarkdown(await buildReportData(root));
    expect(md).toContain("Breaking point: 50 connections — p99 > 2000ms");
    expect(md).toContain("Crashed under load; recovered: no");
    expect(md).toContain("Memory: 3.50 MB/min (leak suspected)");
  });
  it("fixFirst falls back to high; performance has no regression test; screenshots are wrapped", async () => {
    const root = await tmpRoot();
    await addFinding(root, sample({ title: "Slow page", category: "performance", severity: "high", reproduced: true, evidence: { screenshots: ["shots/a b.png"] } }));
    const d = await buildReportData(root);
    expect(d.fixFirst?.title).toBe("Slow page");
    const md = renderMarkdown(d);
    expect(md).not.toContain("Regression test");
    expect(md).toContain("![WR-001-1](<../shots/a b.png>)");
    expect(md).not.toMatch(/\n{3,}/);
  });
  it("flattens multi-line field values", async () => {
    const root = await tmpRoot();
    await addFinding(root, sample({ reproduced: true, actual: "line one\n\n\nline two" }));
    const md = renderMarkdown(await buildReportData(root));
    expect(md).toContain("- **Actual:** line one line two");
    expect(md).not.toMatch(/\n{3,}/);
  });
});
