import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runCli, tmpRoot } from "./helpers.js";
import { listFindings } from "../src/findings.js";
import { severityOf, parseViewport } from "../src/a11y.js";

let server: Server, base: string;
beforeAll(async () => {
  server = createServer((_q, r) => {
    r.setHeader("content-type", "text/html");
    r.end(`<!doctype html><html lang="en"><head><title>T</title></head><body><main><h1>Shop</h1><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><input type="text"></main></body></html>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/shop`;
});
afterAll(() => { server.close(); });

describe("a11y", () => {
  it("maps severities and parses viewport", () => {
    expect([severityOf("critical"), severityOf("serious"), severityOf("moderate"), severityOf("minor")]).toEqual(["high", "medium", "low", "low"]);
    expect(parseViewport("390x844")).toEqual({ width: 390, height: 844 });
    expect(() => parseViewport("big")).toThrow();
  });
  it("scans, writes results, and --record creates mapped findings", async () => {
    const root = await tmpRoot();
    const r = await runCli(["a11y", base, "--viewport", "390x844", "--record", "--json", "--root", root]);
    expect(r.code, r.stderr).toBe(0);
    const [s] = JSON.parse(r.stdout);
    const res = JSON.parse(await readFile(s.file, "utf8"));
    expect(res.url).toBe(base);
    expect(res.scannedAt).toBeTruthy();
    const ids = res.violations.map((v: any) => v.id);
    expect(ids).toContain("image-alt");
    expect(ids).toContain("label");
    const alt = res.violations.find((v: any) => v.id === "image-alt");
    expect(alt.nodes[0]).toMatchObject({ target: "img" });
    expect(alt.nodes[0].html.length).toBeLessThanOrEqual(300);
    expect(s.file).toContain(join(root, ".wreck-it", "a11y"));
    const { findings } = await listFindings(root);
    expect(findings).toHaveLength(res.violations.length);
    const fAlt = findings.find((f) => f.title.includes("(image-alt)"))!;
    expect(fAlt).toMatchObject({ category: "accessibility", severity: "high", persona: "a11y-scan", route: "/shop", reproduced: true, assertions: [] });
    expect(fAlt.title.startsWith("a11y: ")).toBe(true);
    expect(fAlt.steps).toEqual([{ action: "goto", url: base }]);
    expect(fAlt.evidence.console).toEqual([]);
    const fLabel = findings.find((f) => f.title.includes("(label)"))!;
    expect(fLabel.severity).toBe("high");
  }, 60_000);
  it("--record files one finding per rule across pages, appending extra URLs", async () => {
    const root = await tmpRoot();
    const r = await runCli(["a11y", base, base.replace("/shop", "/other"), "--record", "--root", root]);
    expect(r.code, r.stderr).toBe(0);
    const { findings } = await listFindings(root);
    const alts = findings.filter((f) => f.title.includes("(image-alt)"));
    expect(alts).toHaveLength(1);
    expect(alts[0]!.actual).toContain("Also on " + base.replace("/shop", "/other"));
    await runCli(["a11y", base, "--record", "--root", root]);
    expect((await listFindings(root)).findings).toHaveLength(findings.length);
  }, 60_000);
  it("does not create findings without --record", async () => {
    const root = await tmpRoot();
    const r = await runCli(["a11y", base, "--root", root]);
    expect(r.code, r.stderr).toBe(0);
    expect((await listFindings(root)).findings).toHaveLength(0);
  }, 60_000);
  it("exits 3 for a refused target", async () => {
    const r = await runCli(["a11y", "http://example.com", "--root", await tmpRoot()]);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("not localhost");
  });
});
