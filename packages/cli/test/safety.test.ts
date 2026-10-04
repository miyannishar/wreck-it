import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { discover } from "../src/discover/index.js";
import { runFuzz, pathsRegex } from "../src/fuzz.js";
import { runLoadTest } from "../src/load/index.js";
import { saveRefreshed } from "../src/auth.js";
import { readMail, nextTestEmail, linksIn } from "../src/email.js";
import { runPreflight } from "../src/preflight.js";
import { buildReportData } from "../src/report/data.js";
import { renderMarkdown } from "../src/report/markdown.js";
import { recordCreated } from "../src/run.js";
import { tmpRoot } from "./helpers.js";
import { writeTree } from "./fixtures.js";

describe("discover: services, side effects, hosted backends", () => {
  it("marks endpoints whose handler (or a lib it imports) calls AI, email or payments, and reads Stripe key mode", async () => {
    const root = await tmpRoot();
    await writeTree(root, {
      "package.json": JSON.stringify({ dependencies: { next: "16", openai: "4", resend: "3", stripe: "18", "@supabase/supabase-js": "2" } }),
      ".env.local": "STRIPE_SECRET_KEY=sk_live_abc\nNEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co\n",
      "app/api/chat/route.ts": 'import { ask } from "@/lib/ai";\nexport async function POST(req: Request) { const body = await req.json(); return ask(body.prompt); }',
      "lib/ai.ts": 'import OpenAI from "openai";\nexport const ask = (p: string) => new OpenAI().responses.create({ input: p });',
      "app/api/invite/route.ts": 'import { Resend } from "resend";\nexport async function POST(req: Request) { const body = await req.json(); return new Resend().emails.send({ to: body.email }); }',
      "app/api/notes/route.ts": "export async function POST(req: Request) { const body = await req.json(); return save(body.note); }",
      "app/page.tsx": '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>',
    });
    const d = await discover(root);
    const effects = Object.fromEntries(d.api.map((a) => [a.path, a.effects ?? []]));
    expect(effects).toEqual({ "/api/chat": ["ai"], "/api/invite": ["email"], "/api/notes": [] });
    expect(d.services).toMatchObject({ stripeMode: "live", captcha: true, emailConfirmation: true });
    expect(d.services!.uses.sort()).toEqual(["ai", "email", "payments"]);
    expect(d.database).toMatchObject({ kind: "supabase", remote: true });
  });

  it("finds a Supabase project hardcoded in source (Lovable-style) and Firebase projects in env", async () => {
    const lovable = await tmpRoot();
    await writeTree(lovable, {
      "package.json": JSON.stringify({ dependencies: { vite: "6", "@supabase/supabase-js": "2" } }),
      "src/integrations/supabase/client.ts": 'export const supabase = createClient("https://qwertyuiopasdfghjklz.supabase.co", "anon");',
    });
    expect((await discover(lovable)).database).toEqual({ kind: "supabase", url: "https://qwertyuiopasdfghjklz.supabase.co", remote: true });
    const fb = await tmpRoot();
    await writeTree(fb, { "package.json": "{}", ".env": "NEXT_PUBLIC_FIREBASE_PROJECT_ID=my-app\n" });
    expect((await discover(fb)).database).toMatchObject({ kind: "firebase", remote: true });
  });
});

// A tiny API: /api/chat would be a paid AI call, /api/notes a plain write.
let server: Server, base: string;
const hits: string[] = [];
beforeAll(async () => {
  server = createServer(async (q, r) => {
    let raw = ""; for await (const c of q) raw += c;
    const u = new URL(q.url!, "http://x");
    hits.push(`${q.method} ${u.pathname}`);
    const json = (s: number, v: unknown, headers: Record<string, string> = {}) => { r.writeHead(s, { "content-type": "application/json", ...headers }); r.end(JSON.stringify(v)); };
    if (u.pathname === "/api/chat") return json(200, { answer: "…" });
    if (u.pathname === "/api/notes") { try { JSON.parse(raw); return json(201, { ok: true }); } catch { return json(400, {}); } }
    if (u.pathname === "/refresh") return json(200, {}, { "set-cookie": "sid=rotated; Path=/" });
    // A Mailpit-style inbox API on the same server, for the email tests.
    if (u.pathname === "/api/v1/info") return json(200, { Version: "1.20", Messages: 1 });
    if (u.pathname === "/api/v1/search") return json(200, { messages: u.searchParams.get("query")!.includes("new@example.test") ? [{ ID: "m1", Subject: "Confirm your signup", Created: "now" }] : [] });
    if (u.pathname === "/api/v1/message/m1") return json(200, { Subject: "Confirm your signup", Text: "Welcome! Logo https://cdn.example.com/logo.png\nConfirm: http://localhost:3000/auth/confirm?token=abc&type=signup", HTML: "" });
    json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

const disc = (extra: Record<string, unknown> = {}) => JSON.stringify({
  api: [{ method: "POST", path: "/api/chat", file: "chat.ts", effects: ["ai"] }, { method: "POST", path: "/api/notes", file: "notes.ts" }], ...extra,
});
const handlers = {
  "chat.ts": "export async function POST(req) { const body = await req.json(); return ask(body.prompt); }",
  "notes.ts": "export async function POST(req) { const body = await req.json(); return save(body.note); }",
};

describe("fuzz: consent and side effects", () => {
  it("skips endpoints with paid side effects, logs the test data it wrote, and needs consent for a remote database", async () => {
    const root = await tmpRoot();
    await writeTree(root, { ...handlers, ".wreck-it/config.json": JSON.stringify({ baseUrl: base }), ".wreck-it/discovery.json": disc({ database: { kind: "supabase", remote: true } }) });
    await expect(runFuzz(root, { schemathesis: "never" })).rejects.toThrow(/allowRemoteDb/);
    await writeTree(root, { ".wreck-it/config.json": JSON.stringify({ baseUrl: base, allowRemoteDb: true }) });
    hits.length = 0;
    const r = await runFuzz(root, { schemathesis: "never" });
    expect(r.sideEffectSkips).toEqual([{ endpoint: "POST /api/chat", effects: ["ai"] }]);
    expect(hits.some((h) => h === "POST /api/chat")).toBe(false);
    expect(r.writes[0]).toMatchObject({ endpoint: "POST /api/notes" });
    expect((await readFile(join(root, ".wreck-it/created.jsonl"), "utf8"))).toContain("POST /api/notes");
  });

  it("fuzzes them once the user allows that side effect", async () => {
    const root = await tmpRoot();
    await writeTree(root, { ...handlers, ".wreck-it/config.json": JSON.stringify({ baseUrl: base, allowSideEffects: ["ai"] }), ".wreck-it/discovery.json": disc() });
    hits.length = 0;
    const r = await runFuzz(root, { schemathesis: "never", maxRequests: 30 });
    expect(r.sideEffectSkips).toEqual([]);
    expect(hits.some((h) => h === "POST /api/chat")).toBe(true);
  });

  it("builds a Schemathesis exclusion that matches both route styles", () => {
    const re = new RegExp(pathsRegex(["/api/chat", "/api/items/[id]/summary"]));
    expect(re.test("/api/chat")).toBe(true);
    expect(re.test("/api/items/{itemId}/summary")).toBe(true);
    expect(re.test("/api/items/42/summary")).toBe(true);
    expect(re.test("/api/notes")).toBe(false);
  });
});

describe("load: side effects", () => {
  it("refuses an endpoint that calls an AI model before sending a single request", async () => {
    const root = await tmpRoot();
    await writeTree(root, { ".wreck-it/discovery.json": JSON.stringify({ api: [{ method: "GET", path: "/api/summary/[id]", file: "s.ts", effects: ["ai"] }] }) });
    let benched = false;
    await expect(runLoadTest(root, { url: `${base}/api/summary/7`, profile: "ramp" }, { runBench: async () => { benched = true; throw new Error("no"); } }))
      .rejects.toThrow(/paid AI calls/);
    expect(benched).toBe(false);
  });
});

describe("saveRefreshed", () => {
  const state = (sid: string | null) => ({ cookies: sid ? [{ name: "sid", value: sid, domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" as const }] : [], origins: [] });
  it("writes a rotated session back, but never a logged-out one over a good one", async () => {
    const root = await tmpRoot();
    await writeTree(root, {
      ".wreck-it/config.json": JSON.stringify({ baseUrl: base, accounts: [{ label: "main", storageState: ".wreck-it/auth/main.json" }] }),
      ".wreck-it/auth/main.json": JSON.stringify(state("original")),
    });
    const saved = async () => JSON.parse(await readFile(join(root, ".wreck-it/auth/main.json"), "utf8")).cookies.map((c: any) => c.value);
    expect(await saveRefreshed(root, base, "main", state(null))).toBe(false);
    expect(await saved()).toEqual(["original"]);
    expect(await saveRefreshed(root, base, "main", state("rotated"))).toBe(true);
    expect(await saved()).toEqual(["rotated"]);
  });
});

describe("email", () => {
  it("reads the newest mail to an address from a local inbox, confirmation link first", async () => {
    const root = await tmpRoot();
    await writeTree(root, { ".wreck-it/config.json": JSON.stringify({ baseUrl: base, inboxUrl: base }) });
    const r = await readMail(root, "new@example.test", 0);
    expect(r.inbox).toEqual({ kind: "mailpit", url: base });
    expect(r.mail).toMatchObject({ subject: "Confirm your signup" });
    expect(r.mail!.links[0]).toBe("http://localhost:3000/auth/confirm?token=abc&type=signup");
    expect((await readMail(root, "nobody@example.test", 0)).mail).toBeUndefined();
    expect(linksIn('see https://cdn.test/a.png and <a href="https://a.test/verify?t=1&amp;u=2">')).toEqual(["https://a.test/verify?t=1&u=2", "https://cdn.test/a.png"]);
  });

  it("hands out addresses from testEmail, or refuses when no address would be readable", async () => {
    const root = await tmpRoot();
    await writeTree(root, { ".wreck-it/config.json": JSON.stringify({ baseUrl: base, testEmail: "me+wreck{n}@gmail.com", inboxUrl: "http://127.0.0.1:9" }) });
    const a = await nextTestEmail(root), b = await nextTestEmail(root);
    expect(a.address).toMatch(/^me\+wreck\w+@gmail\.com$/);
    expect(a.address).not.toBe(b.address);
    expect(a.readable).toBe("user");
    const none = await tmpRoot();
    await writeTree(none, { ".wreck-it/config.json": JSON.stringify({ baseUrl: base, inboxUrl: "http://127.0.0.1:9" }) });
    await expect(nextTestEmail(none)).rejects.toThrow(/testEmail/);
  });
});

describe("preflight safety", () => {
  it("lists what to ask the user before writing stages", async () => {
    const root = await tmpRoot();
    await writeTree(root, {
      ".gitignore": ".wreck-it/\n",
      ".wreck-it/config.json": JSON.stringify({ baseUrl: base, inboxUrl: "http://127.0.0.1:9" }),
      ".wreck-it/discovery.json": JSON.stringify({ database: { kind: "supabase", url: "https://x.supabase.co", remote: true }, services: { uses: ["ai", "email", "payments"], stripeMode: "live" } }),
    });
    const r = await runPreflight({ root });
    expect(r.safety).toMatchObject({ remoteDb: "supabase (https://x.supabase.co)", email: "none" });
    expect(r.safety.ask).toHaveLength(4);
    expect(r.safety.ask.join(" ")).toMatch(/production/);
    expect(r.safety.ask.join(" ")).toMatch(/LIVE/);
    expect(r.safety.ask.join(" ")).toMatch(/testEmail/);
    expect(r.safety.ask.join(" ")).toMatch(/AI models/);
    await writeTree(root, { ".wreck-it/config.json": JSON.stringify({ baseUrl: base, inboxUrl: "http://127.0.0.1:9", allowRemoteDb: true, testEmail: "me+w{n}@gmail.com", allowSideEffects: ["ai"] }) });
    expect((await runPreflight({ root })).safety.ask).toHaveLength(1);
  });
});

describe("report", () => {
  it("lists the test data wreck-it created", async () => {
    const root = await tmpRoot();
    await recordCreated(root, { by: "normal-user", what: "account wreck.tester+1@example.test" });
    const md = renderMarkdown(await buildReportData(root));
    expect(md).toContain("## Test data created");
    expect(md).toContain("account wreck.tester+1@example.test _(by normal-user)_");
  });
});
