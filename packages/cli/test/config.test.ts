import { describe, it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { tmpRoot } from "./helpers.js";

describe("loadConfig", () => {
  it("returns defaults when no file exists", async () => {
    expect(await loadConfig(await tmpRoot())).toEqual({
      accounts: [], allowMutatingLoad: false, iOwnThis: false, exclude: [],
      thresholds: { p99Ms: 2000, errorRate: 0.01 },
    });
  });
  it("reads and merges a config file", async () => {
    const root = await tmpRoot();
    await mkdir(join(root, ".wreck-it"));
    await writeFile(join(root, ".wreck-it", "config.json"), JSON.stringify({ baseUrl: "http://localhost:4000", thresholds: { p99Ms: 500 } }));
    const c = await loadConfig(root);
    expect(c.baseUrl).toBe("http://localhost:4000");
    expect(c.thresholds).toEqual({ p99Ms: 500, errorRate: 0.01 });
  });
  it("rejects unknown keys", async () => {
    const root = await tmpRoot();
    await mkdir(join(root, ".wreck-it"));
    await writeFile(join(root, ".wreck-it", "config.json"), JSON.stringify({ baseURL: "http://localhost:4000" }));
    await expect(loadConfig(root)).rejects.toMatchObject({ name: "WreckError", message: expect.stringContaining("baseURL") });
    await writeFile(join(root, ".wreck-it", "config.json"), JSON.stringify({ thresholds: { p99ms: 5 } }));
    await expect(loadConfig(root)).rejects.toThrow(/p99ms/);
  });
  it("throws WreckError on invalid JSON", async () => {
    const root = await tmpRoot();
    await mkdir(join(root, ".wreck-it"));
    await writeFile(join(root, ".wreck-it", "config.json"), "{nope");
    await expect(loadConfig(root)).rejects.toThrow(/config\.json/);
  });
});
