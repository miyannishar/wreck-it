import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { wreckPaths, ensureDirs } from "../src/paths.js";
import { tmpRoot } from "./helpers.js";

describe("wreckPaths", () => {
  it("puts all state under .wreck-it and tests under tests/wreck-it", () => {
    const p = wreckPaths("/proj");
    expect(p.dir).toBe(join("/proj", ".wreck-it"));
    expect(p.findings).toBe(join("/proj", ".wreck-it", "findings"));
    expect(p.shots).toBe(join("/proj", ".wreck-it", "shots"));
    expect(p.load).toBe(join("/proj", ".wreck-it", "load"));
    expect(p.config).toBe(join("/proj", ".wreck-it", "config.json"));
    expect(p.run).toBe(join("/proj", ".wreck-it", "run.json"));
    expect(p.visits).toBe(join("/proj", ".wreck-it", "visits.jsonl"));
    expect(p.discovery).toBe(join("/proj", ".wreck-it", "discovery.json"));
    expect(p.personas).toBe(join("/proj", ".wreck-it", "personas.md"));
    expect(p.reportHtml).toBe(join("/proj", ".wreck-it", "report.html"));
    expect(p.reportMd).toBe(join("/proj", ".wreck-it", "report.md"));
    expect(p.testsDir).toBe(join("/proj", "tests", "wreck-it"));
  });
  it("ensureDirs creates the directories", async () => {
    const root = await tmpRoot();
    const p = wreckPaths(root);
    await ensureDirs(p);
    for (const d of [p.dir, p.findings, p.shots, p.load]) expect(existsSync(d)).toBe(true);
  });
});
