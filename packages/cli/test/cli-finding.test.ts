import { describe, it, expect } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCli, tmpRoot } from "./helpers.js";
import { sample } from "./fixtures.js";

describe("finding CLI", () => {
  it("adds via argument and stdin, lists as JSON", async () => {
    const root = await tmpRoot();
    const a = await runCli(["finding", "add", JSON.stringify(sample()), "--root", root]);
    expect(a.code).toBe(0);
    expect(JSON.parse(a.stdout).id).toBe("WR-001");
    const b = await runCli(["finding", "add", "-", "--root", root], { input: JSON.stringify(sample()) });
    expect(JSON.parse(b.stdout).id).toBe("WR-002");
    const l = await runCli(["finding", "list", "--json", "--root", root]);
    expect(JSON.parse(l.stdout)).toHaveLength(2);
  });
  it("exits 2 with field errors on invalid input", async () => {
    const r = await runCli(["finding", "add", JSON.stringify({ title: "x" }), "--root", await tmpRoot()]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/category/);
  });
  it("exits 2 on unknown keys", async () => {
    const r = await runCli(["finding", "add", JSON.stringify(sample({ reproducd: true })), "--root", await tmpRoot()]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/reproducd/);
  });
  it("prints unexpected errors without a stack and exits 1", async () => {
    const root = await tmpRoot();
    await writeFile(join(root, "afile"), "x");
    const r = await runCli(["finding", "add", JSON.stringify(sample()), "--root", join(root, "afile")]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^wreck-it: /);
    expect(r.stderr).not.toMatch(/\n\s+at /);
  });
  it("exits 2 when --file is missing", async () => {
    const r = await runCli(["finding", "add", "--file", "/nonexistent/x.json", "--root", await tmpRoot()]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/cannot read/);
  });
});
