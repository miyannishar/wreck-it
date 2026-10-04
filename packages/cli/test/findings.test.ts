import { describe, it, expect } from "vitest";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { addFinding, updateFinding, listFindings } from "../src/findings.js";
import { tmpRoot } from "./helpers.js";
import { sample } from "./fixtures.js";

describe("findings store", () => {
  it("assigns sequential ids", async () => {
    const root = await tmpRoot();
    expect((await addFinding(root, sample())).finding.id).toBe("WR-001");
    expect((await addFinding(root, sample())).finding.id).toBe("WR-002");
    expect(existsSync(join(root, ".wreck-it", "findings", "WR-002.json"))).toBe(true);
  });
  it("assigns unique ids under 20 concurrent adds", async () => {
    const root = await tmpRoot();
    const res = await Promise.all(Array.from({ length: 20 }, () => addFinding(root, sample())));
    expect(new Set(res.map((r) => r.finding.id)).size).toBe(20);
    expect((await listFindings(root)).findings).toHaveLength(20);
  });
  it("rejects invalid input with exit code 2", async () => {
    await expect(addFinding(await tmpRoot(), { title: "x" })).rejects.toMatchObject({ exitCode: 2 });
  });
  it("copies external screenshots and warns on missing ones", async () => {
    const root = await tmpRoot();
    const ext = join(root, "elsewhere.png");
    await writeFile(ext, "png");
    const { finding, warnings } = await addFinding(root, sample({ evidence: { screenshots: [ext, "missing.png"] } }));
    expect(finding.evidence.screenshots[0]).toBe("shots/WR-001-1.png");
    expect(await readFile(join(root, ".wreck-it", "shots", "WR-001-1.png"), "utf8")).toBe("png");
    expect(finding.evidence.screenshots[1]).toBe("../missing.png");
    expect(warnings).toEqual(["screenshot not found: missing.png"]);
  });
  it("stores a trace path relative to the project (in place), on add and on update", async () => {
    const root = await tmpRoot();
    await mkdir(join(root, ".wreck-it", "shots", "browser-1", "traces"), { recursive: true });
    await writeFile(join(root, ".wreck-it", "shots", "browser-1", "traces", "t.trace"), "trace");
    const abs = join(root, ".wreck-it", "shots", "browser-1", "traces", "t.trace");
    const { finding, warnings } = await addFinding(root, sample({ evidence: { trace: abs } }));
    expect(finding.evidence.trace).toBe(".wreck-it/shots/browser-1/traces/t.trace");
    expect(warnings).toEqual([]);
    const second = await addFinding(root, sample({ evidence: { screenshots: [".wreck-it/shots/browser-1/traces/t.trace"] } }));
    const updated = await updateFinding(root, second.finding.id, { evidence: { trace: abs } });
    expect(updated.evidence.trace).toBe(".wreck-it/shots/browser-1/traces/t.trace");
    expect(updated.evidence.screenshots).toEqual(second.finding.evidence.screenshots);
  });
  it("keeps screenshots already inside .wreck-it as relative paths", async () => {
    const root = await tmpRoot();
    await mkdir(join(root, ".wreck-it", "shots"), { recursive: true });
    await writeFile(join(root, ".wreck-it", "shots", "x.png"), "png");
    const { finding } = await addFinding(root, sample({ evidence: { screenshots: [".wreck-it/shots/x.png"] } }));
    expect(finding.evidence.screenshots[0]).toBe("shots/x.png");
  });
  it("updates fields and re-validates", async () => {
    const root = await tmpRoot();
    await addFinding(root, sample());
    const f = await updateFinding(root, "WR-001", { reproduced: true, source: { file: "app/cart/page.tsx", line: 12, why: "ignores qty", confidence: "high" } });
    expect(f.reproduced).toBe(true);
    expect(f.source?.line).toBe(12);
    await expect(updateFinding(root, "WR-001", { severity: "apocalyptic" })).rejects.toMatchObject({ exitCode: 2 });
    await expect(updateFinding(root, "WR-404", { reproduced: true })).rejects.toThrow(/WR-404/);
  });
  it("rejects unknown keys on add and update", async () => {
    const root = await tmpRoot();
    await expect(addFinding(root, sample({ reproducd: true }))).rejects.toMatchObject({ exitCode: 2, message: expect.stringContaining("reproducd") });
    await expect(addFinding(root, sample({ evidence: { screenshot: [] } }))).rejects.toMatchObject({ exitCode: 2 });
    await addFinding(root, sample());
    await expect(updateFinding(root, "WR-001", { reproducd: true })).rejects.toMatchObject({ exitCode: 2, message: expect.stringContaining("reproducd") });
  });
  it("rejects unknown keys inside source", async () => {
    const root = await tmpRoot();
    const source = { file: "a.ts", line: 3, why: "bad", confidence: "high", lien: 9 };
    await expect(addFinding(root, sample({ source }))).rejects.toMatchObject({ exitCode: 2, message: expect.stringContaining("lien") });
    await addFinding(root, sample());
    await expect(updateFinding(root, "WR-001", { source })).rejects.toMatchObject({ exitCode: 2, message: expect.stringContaining("lien") });
  });
  it("update deep-merges evidence one level", async () => {
    const root = await tmpRoot();
    await mkdir(join(root, ".wreck-it", "shots"), { recursive: true });
    await writeFile(join(root, ".wreck-it", "shots", "x.png"), "png");
    await addFinding(root, sample({ evidence: { screenshots: [".wreck-it/shots/x.png"] } }));
    const f = await updateFinding(root, "WR-001", { evidence: { console: ["boom"] } });
    expect(f.evidence.screenshots).toEqual(["shots/x.png"]);
    expect(f.evidence.console).toEqual(["boom"]);
  });
  it("httpStatus assertions need an http step", async () => {
    const root = await tmpRoot();
    await expect(addFinding(root, sample({ assertions: [{ kind: "httpStatus", equals: 200 }] }))).rejects.toMatchObject({
      exitCode: 2, message: expect.stringContaining("httpStatus assertions need an http step") });
    const ok = await addFinding(root, sample({
      steps: [{ action: "http", method: "GET", url: "/x" }], assertions: [{ kind: "httpStatus", equals: 200 }] }));
    expect(ok.finding.id).toBe("WR-001");
  });
  it("listFindings skips corrupt files and reports them", async () => {
    const root = await tmpRoot();
    await addFinding(root, sample());
    await writeFile(join(root, ".wreck-it", "findings", "WR-009.json"), "{broken");
    const { findings, errors } = await listFindings(root);
    expect(findings).toHaveLength(1);
    expect(errors[0]!.file).toMatch(/WR-009\.json$/);
  });
  it("listFindings on a fresh root returns empty", async () => {
    expect(await listFindings(await tmpRoot())).toEqual({ findings: [], errors: [] });
  });
  it("reports schema-invalid files with a field path", async () => {
    const root = await tmpRoot();
    await mkdir(join(root, ".wreck-it", "findings"), { recursive: true });
    await writeFile(join(root, ".wreck-it", "findings", "WR-005.json"), '{"id":"WR-005"}');
    const { errors } = await listFindings(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/title|category/);
    expect(errors[0]!.message).not.toBe("[");
  });
  it("updateFinding on a corrupt file rejects with exit 2", async () => {
    const root = await tmpRoot();
    await mkdir(join(root, ".wreck-it", "findings"), { recursive: true });
    await writeFile(join(root, ".wreck-it", "findings", "WR-005.json"), '{"id":"WR-005"}');
    await expect(updateFinding(root, "WR-005", { reproduced: true })).rejects.toMatchObject({ exitCode: 2 });
  });
  it("rejects malformed ids in updateFinding", async () => {
    await expect(updateFinding(await tmpRoot(), "../x", {})).rejects.toMatchObject({ exitCode: 2 });
  });
  it("removes the reserved placeholder when add fails", async () => {
    const root = await tmpRoot();
    await mkdir(join(root, "adir"));
    await expect(addFinding(root, sample({ evidence: { screenshots: [join(root, "adir")] } }))).rejects.toThrow();
    expect(existsSync(join(root, ".wreck-it", "findings", "WR-001.json"))).toBe(false);
  });
  it("listFindings never sees partial files during concurrent adds", async () => {
    const root = await tmpRoot();
    let done = false;
    const adds = Promise.all(Array.from({ length: 20 }, () => addFinding(root, sample()))).then(() => { done = true; });
    while (!done) {
      expect((await listFindings(root)).errors).toEqual([]);
      await new Promise((r) => setImmediate(r));
    }
    await adds;
  });
});
