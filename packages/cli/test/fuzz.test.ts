import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fieldsIn, mutationsFor, parseJunit, runFuzz } from "../src/fuzz.js";
import { listFindings } from "../src/findings.js";
import { tmpRoot } from "./helpers.js";
import { writeTree } from "./fixtures.js";

describe("fieldsIn", () => {
  it("treats body.text as a field but body.json() and body.items.map() as calls", () => {
    expect(fieldsIn("const body = await req.json(); const t = body.text; const r = body.json(); body.items.map((x) => x); body?.toString()").body)
      .toEqual({ text: "string", items: "string" });
  });
  it("finds body fields from req.json(), readJson helpers and destructuring, typing numeric ones", () => {
    const src = `
      export async function POST(req) {
        const body = await readJson<{ productId: string; quantity: number }>(req);
        const q = Number(body.quantity) || 1;
        const name = String(body.productId ?? "");
      }
      export async function PATCH(request) {
        const { title, done = false, count } = await request.json();
        if (done === true) {}
        const term = request.nextUrl.searchParams.get("q");
      }`;
    const f = fieldsIn(src);
    expect(f.body).toEqual({ productId: "string", quantity: "number", title: "string", done: "boolean", count: "number" });
    expect(f.query).toEqual(["q"]);
  });
});

describe("mutationsFor", () => {
  it("tries numeric edge cases for numbers and text edge cases for strings, plus null and missing", () => {
    expect(mutationsFor(1).map((m) => m.label)).toEqual(["negative", "zero", "huge number", "fraction", "text for a number", "null", "missing"]);
    const s = mutationsFor("SAVE10");
    expect(s.find((m) => m.label === "padded with spaces")!.value).toBe(" SAVE10 ");
    expect(s.find((m) => m.label === "5,000 characters")!.value).toHaveLength(5000);
  });
});

describe("parseJunit", () => {
  it("extracts the failing operation and its curl reproduction", () => {
    const xml = `<testsuites><testsuite name="schemathesis">
      <testcase name="POST /bookings"><failure type="failure" message="Server error">- Server error&#10;&#10;Reproduce with:&#10;&#10;    curl -X POST -H &apos;Content-Type: application/json&apos; -d &apos;{&quot;nights&quot;: -1}&apos; http://127.0.0.1:8080/bookings</failure></testcase>
      <testcase name="GET /health"></testcase></testsuite></testsuites>`;
    expect(parseJunit(xml)).toEqual([{ operation: "POST /bookings", message: "Server error", method: "POST", url: "http://127.0.0.1:8080/bookings", body: '{"nights": -1}' }]);
  });
});

let server: Server, base: string;
beforeAll(async () => {
  server = createServer(async (q, r) => {
    const u = new URL(q.url!, "http://x");
    let raw = "";
    for await (const c of q) raw += c;
    const json = (status: number, v: unknown) => { r.writeHead(status, { "content-type": "application/json" }); r.end(JSON.stringify(v)); };
    if (u.pathname === "/api/items" && q.method === "GET") return json(200, { items: [{ id: "i-42", name: "Lamp" }] });
    if (u.pathname === "/api/cart" && q.method === "POST") {
      let b: any;
      try { b = JSON.parse(raw); } catch { return json(400, { error: "bad json" }); }
      if (b?.itemId !== "i-42") return json(404, { error: "no such item" });
      const qty = Number(b.qty);
      if (qty < 0) return json(500, { error: "boom" }); // the bug: negative quantity crashes
      return json(201, { ok: true, qty });
    }
    if (u.pathname === "/api/search") {
      try { decodeURIComponent(u.searchParams.get("q") ?? ""); return json(200, { results: [] }); }
      catch { return json(500, { error: "boom" }); }
    }
    json(404, { error: "not found" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

describe("runFuzz", () => {
  it("fuzzes discovered handlers with real ids, records reproduced 500s once, and lists accepted bad values", async () => {
    const root = await tmpRoot();
    await writeTree(root, {
      ".wreck-it/config.json": JSON.stringify({ baseUrl: base }),
      ".wreck-it/discovery.json": JSON.stringify({
        api: [
          { method: "GET", path: "/api/items", file: "items.ts", line: 1 },
          { method: "POST", path: "/api/cart", file: "cart.ts", line: 1 },
          { method: "POST", path: "/api/logout", file: "logout.ts", line: 1 },
        ],
      }),
      "items.ts": "export async function GET() { return list(); }",
      "cart.ts": "export async function POST(req) {\n  const body = await req.json();\n  const n = Number(body.qty);\n  return add(body.itemId, n);\n}",
      "logout.ts": "export async function POST(req) { const body = await req.json(); return out(body.all); }",
    });
    const r = await runFuzz(root, { record: true, schemathesis: "never" });
    expect(r.seeds.map((s) => `${s.method} ${s.path} ${s.baseline}`)).toEqual(["POST /api/cart 201"]);
    expect(r.serverErrors).toEqual([{ endpoint: "POST /api/cart", field: "qty", mutations: ["negative"], status: 500 }]);
    expect(r.accepted).toEqual([{ endpoint: "POST /api/cart", field: "qty", mutations: ["huge number", "fraction", "text for a number"] }]);
    const { findings } = await listFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ title: "POST /api/cart returns 500 when qty is negative", category: "chaos", persona: "fuzz", reproduced: true });
    expect(findings[0]!.steps.at(-1)).toMatchObject({ action: "http", method: "POST", url: "/api/cart", body: '{"qty":-1,"itemId":"i-42"}' });

    const again = await runFuzz(root, { record: true, schemathesis: "never" });
    expect(again.recorded).toEqual([]);
    expect(again.skipped).toHaveLength(1);
  });

  it("--only fuzzes just the focused endpoints, still using real ids from list endpoints outside the scope", async () => {
    const root = await tmpRoot();
    await writeTree(root, {
      ".wreck-it/config.json": JSON.stringify({ baseUrl: base }),
      ".wreck-it/discovery.json": JSON.stringify({ api: [
        { method: "GET", path: "/api/items", file: "items.ts", line: 1 },
        { method: "POST", path: "/api/cart", file: "cart.ts", line: 1 },
        { method: "POST", path: "/api/notes", file: "notes.ts", line: 1 },
      ] }),
      "items.ts": "export async function GET() { return list(); }",
      "cart.ts": "export async function POST(req) {\n  const body = await req.json();\n  const n = Number(body.qty);\n  return add(body.itemId, n);\n}",
      "notes.ts": "export async function POST(req) { const body = await req.json(); return save(body.note); }",
    });
    const r = await runFuzz(root, { schemathesis: "never", only: ["/api/cart"] });
    expect(r.seeds.map((s) => `${s.method} ${s.path} ${s.baseline}`)).toEqual(["POST /api/cart 201"]);
  });

  it("never sends a seed that resolves to another host", async () => {
    const root = await tmpRoot();
    await writeTree(root, {
      ".wreck-it/config.json": JSON.stringify({ baseUrl: base }),
      ".wreck-it/requests.json": JSON.stringify([
        { method: "POST", path: "http://169.254.169.254/latest", body: { a: 1 } },
        { method: "POST", path: "//example.com/x", body: { a: 1 } },
        { method: "POST", path: "/\\example.com/x", body: { a: 1 } },
      ]),
    });
    const r = await runFuzz(root, { schemathesis: "never", seeds: [{ method: "GET", path: "https://example.com/?q=1", query: { q: "1" }, source: "--seed" }] });
    expect(r.requests).toBe(0);
    expect(r.warnings.filter((w) => w.startsWith("skipped seed"))).toHaveLength(4);
  });

  it("uses seeds from --seed and .wreck-it/requests.json, including query fields", async () => {
    const root = await tmpRoot();
    await writeTree(root, {
      ".wreck-it/config.json": JSON.stringify({ baseUrl: base }),
      ".wreck-it/requests.json": JSON.stringify([{ method: "GET", path: "/api/search", query: { q: "lamp" } }]),
    });
    const r = await runFuzz(root, { record: true, schemathesis: "never" });
    expect(r.serverErrors).toEqual([{ endpoint: "GET /api/search", field: "?q", mutations: ["percent sign"], status: 500 }]);
    expect((await listFindings(root)).findings[0]!.title).toBe("GET /api/search returns 500 when query parameter q is percent sign");
  });

  it("refuses a remote database unless allowed, and non-local targets", async () => {
    const root = await tmpRoot();
    await writeTree(root, {
      ".wreck-it/config.json": JSON.stringify({ baseUrl: base }),
      ".wreck-it/discovery.json": JSON.stringify({ api: [], database: { kind: "postgres", remote: true } }),
    });
    await expect(runFuzz(root, { schemathesis: "never" })).rejects.toThrow(/remote/);
    await expect(runFuzz(root, { schemathesis: "never", allowRemoteDb: true })).resolves.toBeTruthy();
    await expect(runFuzz(root, { baseUrl: "https://example.com" })).rejects.toThrow(/not localhost/);
  });
});
