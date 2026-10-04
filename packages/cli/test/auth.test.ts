import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { platform } from "node:os";
import { chromium } from "playwright";
import { openSession, checkSession, runLogin, sessionStatus, protectedCandidates, authRel } from "../src/auth.js";
import { ConfigSchema } from "../src/config.js";
import { detectSso } from "../src/discover/auth.js";
import { renderSpec } from "../src/gentests.js";
import { FindingSchema } from "../src/schema.js";
import { tmpRoot } from "./helpers.js";
import { writeTree, sample } from "./fixtures.js";

// A tiny app: /account needs the sid cookie, otherwise it redirects to /login (a form, or a fake "Sign in with Google" button).
let server: Server, base: string;
const html = (body: string) => `<!doctype html><html lang="en"><head><title>T</title></head><body><main>${body}</main></body></html>`;
beforeAll(async () => {
  server = createServer(async (q, r) => {
    const u = new URL(q.url!, "http://x");
    let raw = ""; for await (const c of q) raw += c;
    const cookie = q.headers.cookie ?? "";
    if (u.pathname === "/login" && q.method === "POST") {
      const ok = new URLSearchParams(raw).get("password") === "pw";
      r.writeHead(303, ok ? { location: "/account", "set-cookie": "sid=good; Path=/; HttpOnly" } : { location: "/login" });
      return r.end();
    }
    if (u.pathname === "/oauth/callback") { r.writeHead(302, { location: "/account", "set-cookie": "sid=good; Path=/; HttpOnly" }); return r.end(); }
    r.setHeader("content-type", "text/html");
    if (u.pathname === "/login") return r.end(html(`<h1>Log in</h1><a href="/oauth/callback">Sign in with Google</a><form method="post" action="/login"><label>Email <input type="email" name="email"></label><label>Password <input type="password" name="password"></label><button>Log in</button></form>`));
    if (u.pathname === "/account") {
      if (!cookie.includes("sid=good")) { r.writeHead(302, { location: "/login" }); return r.end(); }
      return r.end(html("<h1>Your account</h1>"));
    }
    if (u.pathname === "/") return r.end(html("<h1>Home</h1>"));
    // A client-side-only login: the token lives in localStorage and the server never checks it.
    if (u.pathname === "/spa") return r.end(html(`<h1>Welcome</h1><button onclick="localStorage.setItem('token','t'); location.href='/'">Sign in</button>`));
    r.statusCode = 404; r.end("nope");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

const discovery = JSON.stringify({ pages: ["/", "/login", "/account", "/logout"].map((path) => ({ path, file: "x", dynamic: false })) });

describe("config accounts", () => {
  it("accepts email + password or a saved session, and rejects neither", () => {
    expect(ConfigSchema.parse({ accounts: [{ label: "a", email: "e", password: "p" }, { label: "b", storageState: ".wreck-it/auth/b.json" }] }).accounts).toHaveLength(2);
    expect(ConfigSchema.safeParse({ accounts: [{ label: "c", email: "e" }] }).success).toBe(false);
  });
});

describe("openSession", () => {
  it("logs in through the form and saves the session (owner-only), so later runs and tests need no password", async () => {
    const root = await tmpRoot();
    await writeTree(root, { ".wreck-it/discovery.json": discovery, ".wreck-it/config.json": JSON.stringify({ baseUrl: base, accounts: [{ label: "main", email: "a@example.com", password: "pw" }] }) });
    const browser = await chromium.launch();
    try {
      const s = await openSession(browser, root, base, ["/", "/login", "/account"]);
      expect(s).toMatchObject({ label: "main", loggedIn: true, warnings: [] });
      const file = join(root, authRel("main"));
      expect(JSON.parse(await readFile(file, "utf8")).cookies.map((c: any) => c.name)).toEqual(["sid"]);
      if (platform() !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
    } finally { await browser.close(); }
  });

  it("uses a saved session, and reports a missing one instead of guessing", async () => {
    const root = await tmpRoot();
    const state = { cookies: [{ name: "sid", value: "good", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }], origins: [] };
    await writeTree(root, {
      ".wreck-it/auth/g.json": JSON.stringify(state),
      ".wreck-it/config.json": JSON.stringify({ baseUrl: base, accounts: [{ label: "g", storageState: ".wreck-it/auth/g.json" }, { label: "gone", storageState: ".wreck-it/auth/gone.json" }] }),
    });
    const browser = await chromium.launch();
    try {
      expect(await openSession(browser, root, base, [])).toMatchObject({ label: "g", loggedIn: true, state });
      const missing = await openSession(browser, root, base, [], "gone");
      expect(missing.loggedIn).toBe(false);
      expect(missing.warnings[0]).toMatch(/wreck-it login --label gone/);
      await expect(openSession(browser, root, base, [], "nobody")).rejects.toThrow(/no account labelled/);
    } finally { await browser.close(); }
  });
});

describe("checkSession", () => {
  it("is valid when the session reaches a page that sends visitors to login, expired when it doesn't", async () => {
    const cookie = (value: string) => ({ cookies: [{ name: "sid", value, domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" as const }], origins: [] });
    const pages = protectedCandidates(undefined, [{ path: "/" }, { path: "/login" }, { path: "/account" }]);
    expect(pages).toEqual(["/account"]);
    expect(await checkSession(base, cookie("good"), pages)).toEqual({ status: "valid", page: "/account" });
    expect(await checkSession(base, cookie("stale"), pages)).toEqual({ status: "expired", page: "/account" });
    expect(await checkSession(base, cookie("good"), ["/"])).toEqual({ status: "unknown" });
  });
});

describe("runLogin", () => {
  it("saves the session the person created (e.g. via Google), records the account in config, and verifies it", async () => {
    const root = await tmpRoot();
    await writeTree(root, { ".gitignore": ".wreck-it/\n", ".wreck-it/discovery.json": discovery, ".wreck-it/config.json": JSON.stringify({ baseUrl: base, exclude: ["/admin"] }) });
    const r = await runLogin(root, {
      log: () => {},
      drive: async (page) => { await page.getByText("Sign in with Google").click(); await page.waitForURL("**/account"); await page.close(); },
    });
    expect(r).toMatchObject({ label: "main", file: ".wreck-it/auth/main.json", cookies: 1, check: { status: "valid", page: "/account" }, warnings: [] });
    const cfg = JSON.parse(await readFile(join(root, ".wreck-it/config.json"), "utf8"));
    expect(cfg).toEqual({ baseUrl: base, exclude: ["/admin"], accounts: [{ label: "main", storageState: ".wreck-it/auth/main.json" }] });
    expect(await sessionStatus(root)).toEqual({ label: "main", status: "valid", page: "/account" });
  }, 60_000);

  it("never opens tabs of its own while the person signs in (they would interrupt OAuth)", async () => {
    const root = await tmpRoot();
    await writeTree(root, { ".gitignore": ".wreck-it/\n", ".wreck-it/discovery.json": discovery, ".wreck-it/config.json": JSON.stringify({ baseUrl: base }) });
    let extraTabs = 0;
    const r = await runLogin(root, {
      log: () => {},
      drive: async (page) => {
        page.context().on("page", () => { extraTabs++; });
        // Linger before and after signing in, as a person does on Google's screen and on the app.
        await page.waitForTimeout(2500);
        await page.getByText("Sign in with Google").click();
        await page.waitForURL("**/account");
        await page.waitForTimeout(2500);
        await page.close();
      },
    });
    expect(extraTabs).toBe(0);
    expect(r.check.status).toBe("valid");
  }, 60_000);

  it("finishes by itself once the server lets the session in, and saves only the app's cookies", async () => {
    const root = await tmpRoot();
    await writeTree(root, { ".gitignore": ".wreck-it/\n", ".wreck-it/discovery.json": discovery, ".wreck-it/config.json": JSON.stringify({ baseUrl: base }) });
    const started = Date.now();
    const r = await runLogin(root, {
      log: () => {},
      drive: async (page) => {
        // The provider's own cookies end up in the same browser, as Google's do.
        await page.context().addCookies([{ name: "SID", value: "google-secret", domain: ".google.com", path: "/" }]);
        await page.getByText("Sign in with Google").click();
        // …and then the person just keeps using the app; nobody closes the window.
      },
    });
    expect(r.finished).toBe("logged-in");
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(r).toMatchObject({ cookies: 1, dropped: 1, check: { status: "valid", page: "/account" } });
    const saved = await readFile(join(root, r.file), "utf8");
    expect(saved).not.toContain("google-secret");
    expect(JSON.parse(saved).cookies.map((c: any) => c.name)).toEqual(["sid"]);
  }, 60_000);

  it("for apps that check login only in the browser, finishes once the window is back on the app and settled", async () => {
    const root = await tmpRoot();
    await writeTree(root, {
      ".gitignore": ".wreck-it/\n",
      ".wreck-it/discovery.json": JSON.stringify({ pages: [{ path: "/", file: "x", dynamic: false }, { path: "/spa", file: "x", dynamic: false }] }),
      ".wreck-it/config.json": JSON.stringify({ baseUrl: base }),
    });
    const r = await runLogin(root, {
      log: () => {}, url: "/spa", settleMs: 800,
      drive: async (page) => { await page.getByRole("button", { name: "Sign in" }).click(); },
    });
    expect(r.finished).toBe("back-on-app");
    expect(r).toMatchObject({ cookies: 0, localStorage: 1, check: { status: "unknown" } });
  }, 60_000);

  it("refuses to save when the window closed before any login happened", async () => {
    const root = await tmpRoot();
    await writeTree(root, { ".wreck-it/discovery.json": discovery, ".wreck-it/config.json": JSON.stringify({ baseUrl: base }) });
    await expect(runLogin(root, { log: () => {}, drive: async (page) => { await page.close(); } })).rejects.toThrow(/no session was captured/);
  }, 60_000);
});

describe("generated tests", () => {
  it("start from the saved session for findings recorded logged in, overridable per label in CI", () => {
    const f = FindingSchema.parse({ ...sample(), id: "WR-001", createdAt: "x", auth: "main" });
    expect(renderSpec(f, "http://localhost:3000", ".wreck-it/auth/main.json")).toContain(
      'test.use({ baseURL: process.env.WRECK_IT_BASE_URL ?? "http://localhost:3000", storageState: process.env.WRECK_IT_AUTH_MAIN ?? ".wreck-it/auth/main.json" });');
    const g = FindingSchema.parse({ ...sample(), id: "WR-002", createdAt: "x" });
    expect(renderSpec(g, "http://localhost:3000")).not.toContain("storageState");
  });
});

describe("detectSso", () => {
  it("finds Google/GitHub providers and hosted sign-in libraries", async () => {
    const files: Record<string, string> = {
      "auth.ts": 'import Google from "next-auth/providers/google"; export default NextAuth({ providers: [GoogleProvider({}), GitHubProvider({})] })',
      "login.tsx": 'await supabase.auth.signInWithOtp({ email })',
    };
    const ctx = { root: "/", files: Object.keys(files), deps: { "@clerk/nextjs": "1" }, pkg: {}, read: async (f: string) => files[f] ?? "", warn: () => {} };
    expect((await detectSso(ctx)).sort()).toEqual(["clerk (hosted sign-in)", "email link", "github", "google"]);
  });
});
