import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ODDITY_SCRIPT } from "../src/oddity.js";
import { runCli } from "./helpers.js";

type Sig = { kind: string; detail: string; selector?: string };
let browser: Browser, page: Page, server: Server, base: string;
const run = async (html: string): Promise<Sig[]> => {
  await page.setContent(html, { waitUntil: "load" });
  return (await page.evaluate(`(${ODDITY_SCRIPT})()`) as { signals: Sig[] }).signals;
};
const kinds = (s: Sig[]) => s.map((x) => x.kind);

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  server = createServer((req, res) => {
    if (req.url === "/") { res.setHeader("content-type", "text/html"); res.end(`<h1>Home page with enough text</h1><a id=ok href="/ok">ok</a><a id=dead href="/missing">gone</a><a href="/ok#x">anchor</a>`); }
    else if (req.url === "/ok") res.end("fine");
    else { res.statusCode = 404; res.end("nope"); }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await browser?.close(); server?.close(); });

describe("ODDITY_SCRIPT", () => {
  it("is an arrow function expression without trailing semicolon", () => {
    expect(ODDITY_SCRIPT.startsWith("async () =>")).toBe(true);
    expect(ODDITY_SCRIPT.trimEnd().endsWith(";")).toBe(false);
  });
  it("clean page has zero signals", async () => {
    expect(await run(`<h1>Hello there</h1><p>This is a perfectly normal page with content.</p><button>Go</button>`)).toEqual([]);
  });
  it("detects rendered placeholders but skips code/pre/script", async () => {
    const s = await run(`<p>Price: NaN</p><p>Hi undefined</p><p>x [object Object]</p><p>{{ user.name }}</p><p>Lorem ipsum dolor sit amet</p><p>Invalid Date</p><p>value null here</p>
      <code>undefined</code><pre>null</pre><textarea>NaN</textarea><p>nullable and annulled and undefinedness are fine, long enough</p>`);
    const ph = s.filter((x) => x.kind === "rendered-placeholder");
    expect(ph).toHaveLength(7);
    for (const w of ["NaN", "undefined", "[object Object]", "{{ user.name }}", "Lorem ipsum", "Invalid Date", "null"]) expect(ph.some((x) => x.detail.includes(`"${w}`.replace(/ .*/, "")))).toBe(true);
    expect(ph.every((x) => x.selector)).toBe(true);
  });
  it("detects broken images", async () => {
    const s = await run(`<p>Some text that is long enough to count.</p><img id="pic" src="data:image/png;base64,AAAA" width=20 height=20>`);
    expect(s.find((x) => x.kind === "broken-image")?.selector).toBe("#pic");
  });
  it("detects horizontal overflow", async () => {
    const s = await run(`<p>Some text that is long enough.</p><div id="wide" style="width:1600px;height:10px;background:red"></div>`);
    const o = s.filter((x) => x.kind === "horizontal-overflow");
    expect(o.length).toBeGreaterThan(1);
    expect(o.length).toBeLessThanOrEqual(6);
    expect(o.some((x) => x.selector === "#wide")).toBe(true);
  });
  it("detects overlapping interactive elements, not nested ones", async () => {
    const s = await run(`<p>Some text that is long enough.</p>
      <button id="a" style="position:absolute;left:10px;top:200px;width:100px;height:40px">A</button>
      <button id="b" style="position:absolute;left:30px;top:210px;width:100px;height:40px">B</button>
      <a href="#" style="display:block;margin-top:300px"><button id="nested">in link</button></a>`);
    const o = s.filter((x) => x.kind === "overlap");
    expect(o).toHaveLength(1);
    expect(o[0]!.selector).toBe("#a");
  });
  it("detects empty pages", async () => {
    expect(kinds(await run(`<div></div>`))).toContain("empty-page");
  });
  it("detects dead same-origin links via HEAD/GET", async () => {
    await page.goto(base + "/");
    const r = await page.evaluate(`(${ODDITY_SCRIPT})()`) as { url: string; signals: Sig[] };
    expect(r.url).toBe(base + "/");
    const dead = r.signals.filter((x) => x.kind === "dead-link");
    expect(dead).toHaveLength(1);
    expect(dead[0]!.detail).toContain("/missing -> 404");
    expect(dead[0]!.selector).toBe("#dead");
  });
  it("oddity-script command prints the script", async () => {
    const r = await runCli(["oddity-script"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(ODDITY_SCRIPT);
  });
});
