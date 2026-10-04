import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { runSweep } from "../src/sweep.js";
import { listFindings } from "../src/findings.js";
import { tmpRoot, runCli } from "./helpers.js";
import { writeTree } from "./fixtures.js";

const html = (body: string) => `<!doctype html><html lang="en"><head><title>T</title><meta name="viewport" content="width=device-width"></head><body><main><h1>Shop</h1>${body}<footer><a href="/missing">Pricing</a></footer></main></body></html>`;
let server: Server, base: string;
const hits: string[] = [];
beforeAll(async () => {
  server = createServer((q, r) => {
    const path = new URL(q.url!, "http://x").pathname;
    hits.push(path);
    const cookie = q.headers.cookie ?? "";
    if (path === "/login" && q.method === "POST") { r.writeHead(303, { location: "/account", "set-cookie": "sid=1; Path=/" }); return r.end(); }
    const pages: Record<string, string> = {
      "/": html(`<p>Welcome to the shop, browse our items below.</p><a href="/a">A</a> <a href="/items/7">Item 7</a> <a href="/logout">Log out</a>`),
      "/a": html(`<p>Price: NaN dollars for this lovely item</p><img src="/nope.png" alt="gift" width="20" height="20">`),
      "/items/7": html(`<p>Wide item page with a very wide banner.</p><div style="width:900px;height:20px;background:#eee"></div>`),
      "/login": html(`<form method="post" action="/login"><label>Email <input type="email" name="email"></label><label>Password <input type="password" name="password"></label><button>Log in</button></form>`),
      "/account": cookie.includes("sid=1") ? html(`<p>Your account settings are all here.</p>`) : html(`<p>Please log in to continue here.</p>`),
    };
    if (pages[path]) { r.setHeader("content-type", "text/html"); return r.end(pages[path]); }
    r.statusCode = 404; r.end("not found");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

async function project(extra: Record<string, unknown> = {}) {
  const root = await tmpRoot();
  await writeTree(root, {
    ".wreck-it/discovery.json": JSON.stringify({ pages: ["/", "/a", "/items/[id]", "/logout", "/login", "/account"].map((p) => ({ path: p, file: "x", dynamic: p.includes("[") })) }),
    ".wreck-it/config.json": JSON.stringify({ baseUrl: base, ...extra }),
  });
  return root;
}

describe("sweep", () => {
  it("records one reproduced finding per root cause, fills dynamic routes, never visits logout, dedupes on re-run", async () => {
    const root = await project();
    hits.length = 0;
    const r = await runSweep(root, { record: true, a11y: false });
    expect(hits).not.toContain("/logout");
    expect(r.pages).toContain("/items/7");
    const { findings } = await listFindings(root);
    const titles = findings.map((f) => f.title).sort();
    expect(titles).toEqual([
      "/items/7 scrolls horizontally at 390px (mobile)",
      "Broken image: /nope.png",
      "Dead link: /missing (404)",
      'Page renders "NaN" as visible text',
    ]);
    expect(findings.every((f) => f.reproduced && f.persona === "sweep")).toBe(true);
    const dead = findings.find((f) => f.title.startsWith("Dead link"))!;
    expect(dead.actual).toContain("Also on");
    expect(dead.assertions).toEqual([{ kind: "httpStatus", below: 400 }]);
    const again = await runSweep(root, { record: true, a11y: false });
    expect(again.recorded).toEqual([]);
    expect((await listFindings(root)).findings).toHaveLength(4);
  }, 120_000);
  it("never leaves the app's origin, whatever --only says", async () => {
    const root = await project();
    const r = await runSweep(root, { a11y: false, viewports: "1280x800", only: ["//example.com/x", "http://example.com/", "/\\example.com/x"] });
    expect(r.pages).toEqual([]);
    expect(r.warnings.filter((w) => w.startsWith("skipped route"))).toHaveLength(3);
  }, 60_000);
  it("--only sweeps just the focused routes", async () => {
    const root = await project();
    const r = await runSweep(root, { a11y: false, viewports: "1280x800", only: ["/a"] });
    expect(r.pages).toEqual(["/a"]);
  }, 60_000);
  it("logs in with the first configured account, saves its session, and labels findings with it", async () => {
    const root = await project({ accounts: [{ label: "a", email: "a@b.co", password: "pw" }] });
    const r = await runSweep(root, { a11y: false, viewports: "1280x800", record: true });
    expect(r.loggedIn).toBe(true);
    expect(existsSync(join(root, ".wreck-it/auth/a.json"))).toBe(true);
    const { findings } = await listFindings(root);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.auth === "a")).toBe(true);
    expect(JSON.stringify(findings)).not.toContain('"pw"');
  }, 60_000);
  it("refuses public targets with exit 3", async () => {
    const r = await runCli(["sweep", "--base-url", "https://example.com", "--root", await tmpRoot()]);
    expect(r.code).toBe(3);
  });
});
