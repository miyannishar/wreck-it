import { describe, it, expect } from "vitest";
import { runCli } from "./helpers.js";

describe("cli", () => {
  it("prints version", async () => {
    const r = await runCli(["--version"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("0.1.0");
  });
  it("unknown command exits non-zero", async () => {
    const r = await runCli(["nope"]);
    expect(r.code).not.toBe(0);
  });
  it("schema finding prints a JSON schema", async () => {
    const r = await runCli(["schema", "finding"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).properties.category.enum).toContain("oddity");
  });
});
