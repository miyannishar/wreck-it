import { describe, it, expect } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ConfigSchema } from "../src/config.js";
import { isExcluded, loadTarget, resolveTarget, pagesOf } from "../src/context.js";
import { WreckError } from "../src/errors.js";
import { tmpRoot } from "./helpers.js";

const cfg = (over: object = {}) => ConfigSchema.parse(over);

describe("isExcluded", () => {
  it("skips sign-out routes and configured prefixes", () => {
    const c = cfg({ exclude: ["/admin", "/health/"] });
    expect(isExcluded(c, "/logout")).toBe(true);
    expect(isExcluded(c, "/admin/users")).toBe(true);
    expect(isExcluded(c, "/health/live")).toBe(true);
    expect(isExcluded(c, "/administrators")).toBe(false);
  });
  it("skips /api/ only when asked to", () => {
    expect(isExcluded(cfg(), "/api/cart")).toBe(false);
    expect(isExcluded(cfg(), "/api/cart", { api: true })).toBe(true);
  });
});

describe("loadTarget / resolveTarget", () => {
  async function project(config: object, discovery?: object) {
    const root = await tmpRoot();
    await mkdir(join(root, ".wreck-it"), { recursive: true });
    await writeFile(join(root, ".wreck-it", "config.json"), JSON.stringify(config));
    if (discovery) await writeFile(join(root, ".wreck-it", "discovery.json"), JSON.stringify(discovery));
    return root;
  }

  it("prefers --base-url, then config, then discovery, then localhost:3000", async () => {
    const both = await project({ baseUrl: "http://localhost:4000" }, { baseUrl: "http://localhost:5000" });
    expect((await loadTarget(both, "http://localhost:9000")).base).toBe("http://localhost:9000");
    expect((await loadTarget(both)).base).toBe("http://localhost:4000");
    const disc = await project({}, { baseUrl: "http://localhost:5000" });
    expect((await loadTarget(disc)).base).toBe("http://localhost:5000");
    expect((await loadTarget(await project({}))).base).toBe("http://localhost:3000");
  });

  it("refuses a base URL that is not the user's own machine", async () => {
    const root = await project({});
    await expect(resolveTarget(root, { baseUrl: "https://example.com" })).rejects.toMatchObject({ exitCode: 3 });
    await expect(resolveTarget(root, { baseUrl: "https://example.com" })).rejects.toBeInstanceOf(WreckError);
    expect((await resolveTarget(root, { baseUrl: "https://example.com", iOwnThis: true })).base).toBe("https://example.com");
  });

  it("tolerates a missing or malformed discovery file", async () => {
    expect(pagesOf(undefined)).toEqual([]);
    expect(pagesOf({ pages: "nope" as never })).toEqual([]);
  });
});
