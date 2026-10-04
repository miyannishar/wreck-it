import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { appendFile, writeFile } from "node:fs/promises";
import { initRun, setStage, recordVisit, readRun } from "../src/run.js";
import { addFinding } from "../src/findings.js";
import { tmpRoot, runCli } from "./helpers.js";
import { sample } from "./fixtures.js";

describe("run state", () => {
  it("init + stage + visits", async () => {
    const root = await tmpRoot();
    await initRun(root, { fresh: false });
    await setStage(root, "discover", "done");
    await Promise.all([recordVisit(root, "/a", "normal-user"), recordVisit(root, "/b", "rushed-beginner")]);
    const { run, visits } = await readRun(root);
    expect(run?.stages.discover).toBe("done");
    expect(visits.map((v) => v.route).sort()).toEqual(["/a", "/b"]);
  });
  it("fresh init clears previous findings", async () => {
    const root = await tmpRoot();
    await addFinding(root, sample());
    await initRun(root, { fresh: true });
    expect(existsSync(join(root, ".wreck-it", "findings", "WR-001.json"))).toBe(false);
  });
  it("rejects unknown stage", async () => {
    await expect(setStage(await tmpRoot(), "vibes" as any, "done")).rejects.toThrow(/stage/);
  });
  it("ignores malformed visit lines", async () => {
    const root = await tmpRoot();
    await recordVisit(root, "/a", "p");
    await appendFile(join(root, ".wreck-it", "visits.jsonl"), "garbage\n");
    expect((await readRun(root)).visits).toHaveLength(1);
  });
  it("readRun treats wrong-shaped run.json as no run", async () => {
    const root = await tmpRoot();
    await initRun(root, { fresh: false });
    for (const bad of ["{}", "[]", '{"stages":[]}', "null"]) {
      await writeFile(join(root, ".wreck-it", "run.json"), bad);
      expect((await readRun(root)).run).toBeNull();
    }
    await expect(setStage(root, "report", "done")).resolves.toBeDefined();
  });
  it("readRun on empty root", async () => {
    expect(await readRun(await tmpRoot())).toEqual({ run: null, visits: [] });
  });
});

describe("run CLI", () => {
  it("init, stage, visit, show", async () => {
    const root = await tmpRoot();
    expect((await runCli(["run", "init", "--root", root])).code).toBe(0);
    expect((await runCli(["run", "stage", "discover", "done", "--root", root])).code).toBe(0);
    expect((await runCli(["run", "visit", "/a", "--persona", "p", "--root", root])).code).toBe(0);
    const show = await runCli(["run", "show", "--root", root]);
    const out = JSON.parse(show.stdout);
    expect(out.run.stages.discover).toBe("done");
    expect(out.visits).toEqual([{ route: "/a", persona: "p" }]);
  });
  it("visit requires --persona; bad stage exits 2", async () => {
    const root = await tmpRoot();
    expect((await runCli(["run", "visit", "/a", "--root", root])).code).not.toBe(0);
    expect((await runCli(["run", "stage", "vibes", "done", "--root", root])).code).toBe(2);
  });
});
