import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { addFinding } from "../src/findings.js";
import { buildReportData } from "../src/report/data.js";
import { renderHtml, writeReport } from "../src/report/html.js";
import { latencyChart } from "../src/report/charts.js";
import { escapeHtml } from "../src/report/escape.js";
import { runCli, tmpRoot } from "./helpers.js";
import { sample } from "./fixtures.js";

describe("html report", () => {
  it("writeReport survives a wrong-shaped run.json; CLI exits 0", async () => {
    const root = await tmpRoot();
    await mkdir(join(root, ".wreck-it"), { recursive: true });
    await writeFile(join(root, ".wreck-it", "run.json"), "{}");
    const r = await writeReport(root);
    expect(existsSync(r.html)).toBe(true);
    expect(r.warnings).toEqual([]);
    const c = await runCli(["report", "--root", root]);
    expect(c.code).toBe(0);
  });
  it("CLI report prints a warnings count to stderr", async () => {
    const root = await tmpRoot();
    await mkdir(join(root, ".wreck-it", "findings"), { recursive: true });
    await writeFile(join(root, ".wreck-it", "findings", "WR-009.json"), "{broken");
    const c = await runCli(["report", "--root", root]);
    expect(c.code).toBe(0);
    expect(c.stderr).toMatch(/\d+ warnings \(see report\)/);
  });
  it("escapes", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
  it("renders finding markup as text, never as elements", async () => {
    const root = await tmpRoot();
    const markup = `<b>bold</b><i class="x">italic</i>`;
    await addFinding(root, sample({ title: `Name field echoes ${markup}`, actual: markup, reproduced: true,
      steps: [{ action: "fill", target: { by: "label", value: markup }, value: markup }] }));
    const html = renderHtml(await buildReportData(root), () => null);
    expect(html).not.toContain("<b>bold</b>");
    expect(html).not.toContain('<i class="x">');
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).not.toMatch(/<script/i);
  });
  it("embeds screenshots as data URIs and loads nothing external", async () => {
    const root = await tmpRoot();
    await mkdir(join(root, ".wreck-it", "shots"), { recursive: true });
    await writeFile(join(root, ".wreck-it", "shots", "a.png"), Buffer.from([1, 2, 3]));
    await addFinding(root, sample({ reproduced: true, evidence: { screenshots: [".wreck-it/shots/a.png"] } }));
    const html = renderHtml(await buildReportData(root), (rel) => (rel === "shots/a.png" ? Buffer.from([1, 2, 3]) : null));
    expect(html).toContain("data:image/png;base64,AQID");
    expect(html).not.toMatch(/(src|href)="https?:/);
  });
  it("chart renders two polylines", () => {
    const svg = latencyChart({
      url: "u", method: "GET", profile: "ramp", startedAt: "t", breakingPoint: { connections: 50, reason: "p99 2500ms > 2000ms" },
      crashed: false, recovered: null, memory: null,
      phases: [10, 25, 50].map((c) => ({ label: `ramp-${c}`, connections: c, durationSec: 1, requests: 1, rps: 1,
        latency: { p50: c, p90: c * 2, p99: c * 3, max: c * 4 }, errors: 0, timeouts: 0, non2xx: 0, errorRate: c === 50 ? 0.2 : 0 })),
    });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.match(/<polyline/g)?.length).toBe(2);
  });
  it("CLI writes both files and prints the score", async () => {
    const root = await tmpRoot();
    await addFinding(root, sample({ reproduced: true }));
    const r = await runCli(["report", "--root", root]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Readiness 90\/100 \(Ship it\)/);
    expect(existsSync(join(root, ".wreck-it", "report.html"))).toBe(true);
    expect(existsSync(join(root, ".wreck-it", "report.md"))).toBe(true);
  });
});
