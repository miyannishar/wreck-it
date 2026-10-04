import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { summarizeLhr, isDevHtml, runPerf } from "../src/perf.js";
import { listFindings } from "../src/findings.js";
import { tmpRoot } from "./helpers.js";
import { writeTree } from "./fixtures.js";

const audit = (numericValue: number, extra: Record<string, unknown> = {}) => ({ numericValue, ...extra });
const lhr = {
  categories: {
    performance: { score: 0.42, auditRefs: [{ id: "largest-contentful-paint" }, { id: "unused-javascript" }, { id: "tiny" }] },
    "best-practices": { auditRefs: [{ id: "errors-in-console" }, { id: "doctype" }] },
    seo: { auditRefs: [{ id: "meta-description" }] },
  },
  audits: {
    "largest-contentful-paint": audit(5200),
    "cumulative-layout-shift": audit(0.05),
    "total-blocking-time": audit(700),
    "unused-javascript": { title: "Reduce unused JavaScript", displayValue: "Est savings of 300 KiB", score: 0.2, details: { type: "opportunity", overallSavingsMs: 1200 } },
    tiny: { title: "Tiny win", score: 0.5, details: { type: "opportunity", overallSavingsMs: 50 } },
    "errors-in-console": { title: "Browser errors were logged to the console", scoreDisplayMode: "binary", score: 0 },
    doctype: { title: "Page has the HTML doctype", scoreDisplayMode: "binary", score: 1 },
    "meta-description": { title: "Document does not have a meta description", scoreDisplayMode: "binary", score: 0 },
  },
};

describe("summarizeLhr", () => {
  it("flags poor metrics, keeps big opportunities only, and lists failing binary audits", () => {
    const s = summarizeLhr(lhr);
    expect(s.score).toBe(42);
    expect(s.metrics).toEqual([
      { label: "LCP", value: 5200, display: "5.2 s", poor: true },
      { label: "CLS", value: 0.05, display: "0.05", poor: false },
      { label: "TBT", value: 700, display: "0.7 s", poor: true },
    ]);
    expect(s.opportunities).toEqual([{ title: "Reduce unused JavaScript", display: "Est savings of 300 KiB" }]);
    expect(s.failing).toEqual([
      { category: "best-practices", title: "Browser errors were logged to the console" },
      { category: "seo", title: "Document does not have a meta description" },
    ]);
  });
});

describe("isDevHtml", () => {
  it("recognizes Vite, webpack and Turbopack dev servers but not production HTML", () => {
    expect(isDevHtml('<script type="module" src="/@vite/client"></script>')).toBe(true);
    expect(isDevHtml('<script src="/_next/static/chunks/%5Bturbopack%5D_browser_dev_hmr-client_hmr-client_ts.js"></script>')).toBe(true);
    expect(isDevHtml('self.__next_f.push([1,"{\\"b\\":\\"development\\"}"])')).toBe(true);
    expect(isDevHtml('<script src="/_next/static/chunks/main-abc123.js"></script>')).toBe(false);
  });
});

let server: Server, base: string;
const accountHits: string[] = [];
const page = (h1: string, body = "") => `<!doctype html><html lang="en"><head><title>${h1}</title><meta name="viewport" content="width=device-width"><meta name="description" content="A fast page"></head><body><main><h1>${h1}</h1>${body}</main></body></html>`;
beforeAll(async () => {
  server = createServer((q, r) => {
    const path = new URL(q.url!, "http://x").pathname;
    const cookie = q.headers.cookie ?? "";
    if (path === "/login" && q.method === "POST") { r.writeHead(303, { location: "/account", "set-cookie": "sid=s3cr3t-session; Path=/; HttpOnly" }); return r.end(); }
    r.setHeader("content-type", "text/html");
    if (path === "/") return r.end(page("Fast page", "<p>Nothing to see.</p>"));
    if (path === "/login") return r.end(page("Log in", `<form method="post" action="/login"><label>Email <input type="email" name="email"></label><label>Password <input type="password" name="password"></label><button>Log in</button></form>`));
    if (path === "/account") { accountHits.push(cookie); return r.end(cookie.includes("sid=s3cr3t-session") ? page("Your account") : page("Please log in")); }
    r.statusCode = 404; r.end("not found");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

describe("runPerf", () => {
  it("measures a fast page, saves the Lighthouse report and records nothing", async () => {
    const root = await tmpRoot();
    await writeTree(root, { ".wreck-it/config.json": JSON.stringify({ baseUrl: base }) });
    const r = await runPerf(root, { urls: ["/"], record: true });
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]!.error).toBeUndefined();
    expect(r.pages[0]!.metrics.map((m) => m.label)).toEqual(["LCP", "CLS", "TBT"]);
    expect(r.pages[0]!.metrics.every((m) => !m.poor)).toBe(true);
    expect(existsSync(join(root, r.pages[0]!.report!))).toBe(true);
    expect((await listFindings(root)).findings).toHaveLength(0);
    expect(existsSync(join(root, ".wreck-it/perf/summary-mobile.json"))).toBe(true);
  }, 120_000);

  it("measures a protected page logged in, without writing the session cookie into the report", async () => {
    const root = await tmpRoot();
    await writeTree(root, { ".wreck-it/config.json": JSON.stringify({ baseUrl: base, accounts: [{ label: "a", email: "a@example.com", password: "pw" }] }) });
    accountHits.length = 0;
    const r = await runPerf(root, { urls: ["/account"] });
    expect(r.loggedIn).toBe(true);
    expect(r.pages[0]!.error).toBeUndefined();
    expect(accountHits.at(-1)).toContain("sid=s3cr3t-session");
    const report = await readFile(join(root, r.pages[0]!.report!), "utf8");
    expect(report).not.toContain("s3cr3t-session");
  }, 120_000);

  it("refuses a non-local target", async () => {
    const root = await tmpRoot();
    await expect(runPerf(root, { urls: ["https://example.com/"] })).rejects.toThrow(/not localhost/);
  });
});
