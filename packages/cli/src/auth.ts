import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { launchChromium } from "./browser.js";
import { loadConfig, type Account } from "./config.js";
import { wreckPaths } from "./paths.js";
import { NAV_AWAY, loadTarget, resolveTarget, pagesOf, readJson } from "./context.js";
import { WreckError } from "./errors.js";
import { chromePath } from "./setup.js";

export type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
export type SessionStatus = "valid" | "expired" | "missing" | "unknown";
export interface Session { label?: string; state?: StorageState; loggedIn: boolean | null; warnings: string[] }

export const LOGIN_PAGE = /(^|\/)(log-?in|sign-?in)$/i;
const LOGIN_PATH = /(^|\/)(log-?in|sign-?in|signin|auth|sso|oauth)(\/|$)/i;
const PROTECTED_HINT = /(^|\/)(account|settings|profile|dashboard|orders|billing|admin|app|me|home|projects|workspace|inbox|feed|cart|checkout)(\/|$)/i;

/** Where a label's saved session lives, relative to the project (as written into config and generated tests). */
export const authRel = (label: string) => `.wreck-it/auth/${label.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "main"}.json`;

export function pickAccount(accounts: Account[], label?: string): Account | undefined {
  if (!label) return accounts[0];
  const a = accounts.find((x) => x.label === label);
  if (!a) throw new WreckError(`no account labelled "${label}" in .wreck-it/config.json`, 2);
  return a;
}

/**
 * Only the app's own cookies and local storage. A login window also collects the identity provider's cookies
 * (Google's alone are dozens: a live Google login), which have no business in a file next to the project.
 */
export function appState(state: StorageState, base: string): StorageState {
  const { hostname, origin } = new URL(base);
  const ours = (domain: string) => { const d = domain.replace(/^\./, "").toLowerCase(); return hostname === d || hostname.endsWith("." + d); };
  return { cookies: state.cookies.filter((c) => ours(c.domain)), origins: state.origins.filter((o) => o.origin === origin) };
}

const cookieHeader = (s: StorageState, base: string) => appState(s, base).cookies.map((c) => `${c.name}=${c.value}`).join("; ");

async function writeState(root: string, file: string, state: StorageState): Promise<void> {
  await mkdir(join(wreckPaths(root).dir, "auth"), { recursive: true });
  await writeFile(join(root, file), JSON.stringify(state, null, 2));
  await chmod(join(root, file), 0o600).catch(() => {});
}

const expired = (s: StorageState): boolean =>
  s.cookies.length > 0 && s.cookies.every((c) => c.expires > 0 && c.expires < Date.now() / 1000) && !s.origins.some((o) => o.localStorage.length);

/** Best-effort form login: email + password + Enter, on one page or with the password on a second step. */
export async function formLogin(ctx: BrowserContext, base: string, pages: string[], acct: { email: string; password: string }): Promise<boolean> {
  const path = pages.find((p) => LOGIN_PAGE.test(p)) ?? "/login";
  const page = await ctx.newPage();
  try {
    await page.goto(new URL(path, base).href, { waitUntil: "load", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    const user = page.locator('input[type="email"], input[name*="email" i], input[name*="user" i], input[id*="email" i], input[autocomplete="username"]').first();
    const pass = page.locator('input[type="password"]').first();
    if (!(await user.count())) return false;
    await user.fill(acct.email);
    if (!(await pass.count())) {
      await user.press("Enter");
      await pass.waitFor({ state: "visible", timeout: 8_000 }).catch(() => {});
      if (!(await pass.count())) return false;
    }
    await pass.fill(acct.password);
    await pass.press("Enter");
    await page.waitForURL((u) => u.pathname !== path, { timeout: 8_000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    return new URL(page.url()).pathname !== path || !(await pass.count());
  } catch { return false; }
  finally { await page.close().catch(() => {}); }
}

/**
 * The logged-in state for an account: its saved session (from `wreck-it login`), or a form login whose session is
 * saved too, so later commands and generated tests never need the password.
 */
export async function openSession(browser: Browser, root: string, base: string, pages: string[], label?: string): Promise<Session> {
  const acct = pickAccount((await loadConfig(root)).accounts, label);
  if (!acct) return { loggedIn: null, warnings: ["no account in .wreck-it/config.json; testing logged out (run `wreck-it login` for apps with Google/GitHub sign-in)"] };
  const relogin = `run \`wreck-it login --label ${acct.label}\``;
  if (acct.storageState) {
    const state = await readJson<StorageState>(join(root, acct.storageState));
    if (!state) return { label: acct.label, loggedIn: false, warnings: [`saved session for "${acct.label}" is missing; ${relogin}`] };
    if (expired(state)) return { label: acct.label, loggedIn: false, warnings: [`saved session for "${acct.label}" has expired; ${relogin}`] };
    return { label: acct.label, state, loggedIn: true, warnings: [] };
  }
  const ctx = await browser.newContext();
  try {
    if (!(await formLogin(ctx, base, pages, { email: acct.email!, password: acct.password! })))
      return { label: acct.label, loggedIn: false, warnings: [`could not log in as "${acct.label}" with the login form; testing logged out. For Google/GitHub sign-in or magic links, run \`wreck-it login\``] };
    const state = await ctx.storageState();
    await writeState(root, authRel(acct.label), state);
    return { label: acct.label, state, loggedIn: true, warnings: [] };
  } finally { await ctx.close().catch(() => {}); }
}

/**
 * Write a run's refreshed session back. Apps like Supabase rotate the refresh token on every refresh, so the saved
 * copy goes stale. Never overwrites a good session with a logged-out one: every saved cookie must still be there.
 */
export async function saveRefreshed(root: string, base: string, label: string | undefined, fresh: StorageState): Promise<boolean> {
  const acct = (await loadConfig(root)).accounts.find((a) => a.label === label);
  if (!acct || !label) return false;
  const file = acct.storageState ?? authRel(label);
  const saved = await readJson<StorageState>(join(root, file));
  if (!saved) return false;
  const before = appState(saved, base), after = appState(fresh, base);
  const live = (c: { expires: number }) => c.expires <= 0 || c.expires > Date.now() / 1000;
  if (!before.cookies.length || !before.cookies.every((c) => after.cookies.some((d) => d.name === c.name && live(d)))) return false;
  if (cookieHeader(saved, base) === cookieHeader(fresh, base)) return false;
  await writeState(root, file, { cookies: after.cookies, origins: after.origins.length ? after.origins : before.origins });
  return true;
}

/** Server answer for one page, without a browser: does it let this visitor in, or send them to log in? */
async function gate(url: string, cookie = ""): Promise<"in" | "out" | "other"> {
  try {
    const r = await fetch(url, { redirect: "manual", headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(8_000) });
    await r.body?.cancel().catch(() => {});
    if (r.status === 401 || r.status === 403) return "out";
    if (r.status >= 300 && r.status < 400) {
      const to = new URL(r.headers.get("location") ?? "/", url);
      return LOGIN_PATH.test(to.pathname) || to.origin !== new URL(url).origin ? "out" : "other";
    }
    return r.ok ? "in" : "other";
  } catch { return "other"; }
}

/** The first candidate page the server keeps from logged-out visitors. */
async function findGate(base: string, candidates: string[]): Promise<string | undefined> {
  for (const path of candidates.slice(0, 5)) if ((await gate(new URL(path, base).href)) === "out") return path;
  return undefined;
}

/** Pages likely to need login: config.authCheck first, then account-ish static pages, then the rest. */
export function protectedCandidates(authCheck: string | undefined, pages: { path: string; dynamic?: boolean }[]): string[] {
  const statics = pages.filter((p) => !p.dynamic && p.path !== "/" && !NAV_AWAY.test(p.path) && !LOGIN_PATH.test(p.path) && !p.path.startsWith("/api/")).map((p) => p.path);
  return [...new Set([...(authCheck ? [authCheck] : []), ...statics.filter((p) => PROTECTED_HINT.test(p)), ...statics])];
}

/** Valid when the session opens a page that sends logged-out visitors to log in; unknown when no such page exists. */
export async function checkSession(base: string, state: StorageState, candidates: string[]): Promise<{ status: SessionStatus; page?: string }> {
  const page = await findGate(base, candidates);
  if (!page) return { status: "unknown" };
  return { status: (await gate(new URL(page, base).href, cookieHeader(state, base))) === "in" ? "valid" : "expired", page };
}

export async function sessionStatus(root: string, label?: string): Promise<{ label?: string; status: SessionStatus; page?: string }> {
  const { cfg, disc, base } = await loadTarget(root);
  const acct = pickAccount(cfg.accounts, label);
  if (!acct?.storageState) return { label: acct?.label, status: "unknown" };
  const state = await readJson<StorageState>(join(root, acct.storageState));
  if (!state) return { label: acct.label, status: "missing" };
  if (expired(state)) return { label: acct.label, status: "expired" };
  return { label: acct.label, ...(await checkSession(base, state, protectedCandidates(cfg.authCheck, pagesOf(disc)))) };
}

/** Add or update an account in .wreck-it/config.json, keeping every other setting as written. */
async function upsertAccount(root: string, label: string, storageState: string): Promise<void> {
  const file = wreckPaths(root).config;
  const raw = await readFile(file, "utf8").catch(() => "{}");
  let j: any;
  try { j = JSON.parse(raw); } catch { throw new WreckError(`${file} is not valid JSON; fix it, then run \`wreck-it login\` again`, 2); }
  const accounts: any[] = Array.isArray(j.accounts) ? j.accounts : [];
  const i = accounts.findIndex((a) => a?.label === label);
  if (i >= 0) accounts[i] = { ...accounts[i], storageState }; else accounts.push({ label, storageState });
  await writeFile(file, JSON.stringify({ ...j, accounts }, null, 2) + "\n");
}

export type LoginFinish = "logged-in" | "back-on-app" | "window-closed" | "timeout";
export interface LoginResult {
  label: string; file: string; cookies: number; localStorage: number; dropped: number; finished: LoginFinish;
  check: { status: SessionStatus; page?: string }; warnings: string[];
}
export interface LoginOptions {
  label?: string; url?: string; timeoutSec?: number; iOwnThis?: boolean; log?: (s: string) => void;
  /** Tests only: run headless and let this function play the person. */
  drive?: (page: Page) => Promise<void>;
  /** Tests only: how long the window must sit on the app before "back-on-app" (ms). */
  settleMs?: number;
}

/**
 * Cookies plus local storage of the open tabs, read without opening any tab. (`ctx.storageState()` opens a temporary
 * tab per origin; polling it flashes tabs and breaks the OAuth redirect mid-login.)
 */
async function snapshot(ctx: BrowserContext, origins: Map<string, { name: string; value: string }[]>): Promise<StorageState | undefined> {
  for (const page of ctx.pages()) {
    try {
      const o = new URL(page.url()).origin;
      if (o.startsWith("http")) origins.set(o, (await page.evaluate("Object.entries(localStorage).map(([name, value]) => ({ name, value }))")) as { name: string; value: string }[]);
    } catch { /* navigating or closed: keep the last read */ }
  }
  try { return { cookies: await ctx.cookies(), origins: [...origins].filter(([, ls]) => ls.length).map(([origin, localStorage]) => ({ origin, localStorage })) }; }
  catch { return undefined; }
}

/**
 * Show a browser at `start` and finish as soon as the person is logged in: when the session opens the gate page
 * ("logged-in"), or, for apps without a server-side gate, when the window has been back on the app with new session
 * data for a few seconds ("back-on-app"). Closing the window or the timeout also finish it.
 */
async function captureLogin(start: string, base: string, gatePage: string | undefined, opts: LoginOptions, log: (s: string) => void): Promise<{ state?: StorageState; finished: LoginFinish }> {
  // Real Chrome when installed (Google is less likely to refuse it), without the "controlled by automated software" flag.
  const browser = await launchChromium({
    headless: !!opts.drive, ...(chromePath() && !opts.drive ? { channel: "chrome" } : {}),
    ignoreDefaultArgs: ["--enable-automation"], args: ["--disable-blink-features=AutomationControlled"],
  });
  const app = new URL(base);
  const key = (s?: StorageState) => (s ? JSON.stringify(appState(s, base)) : "");
  let state: StorageState | undefined, finished: LoginFinish = "window-closed";
  try {
    const ctx = await browser.newContext({ viewport: null });
    const origins = new Map<string, { name: string; value: string }[]>();
    // Also snapshot on every page load: on Windows/Linux, closing the last window quits the browser.
    ctx.on("page", (p) => p.on("load", () => { snapshot(ctx, origins).then((s) => { if (s) state = s; }, () => {}); }));
    const page = await ctx.newPage();
    await page.goto(start, { waitUntil: "load", timeout: 60_000 }).catch(() => {});
    const before = key(await snapshot(ctx, origins));
    log(`A browser window opened at ${start}. Log in as the test user the way you normally do (Google, GitHub, email link, 2FA…).`);
    log("wreck-it notices when you're logged in, saves the session and closes the window. (Closing it yourself also works.)");
    if (opts.drive) void opts.drive(page).catch(() => {});
    const deadline = Date.now() + (opts.timeoutSec ?? 600) * 1000;
    let checked = before, settledAt = 0, settledOn = "";
    while (browser.isConnected() && ctx.pages().length > 0) {
      if (Date.now() >= deadline) { finished = "timeout"; break; }
      state = (await snapshot(ctx, origins)) ?? state;
      const k = key(state);
      if (gatePage) {
        // Ask the server only when the app's session data changed; the window is never touched.
        if (k !== checked && k !== before) {
          checked = k;
          if ((await gate(new URL(gatePage, base).href, cookieHeader(state!, base))) === "in") { finished = "logged-in"; break; }
        }
      } else {
        const here = ctx.pages().map((p) => p.url()).find((u) => u.startsWith(app.origin) && !LOGIN_PATH.test(new URL(u).pathname));
        const onAppWithNewData = here && k !== before ? `${here} ${k}` : "";
        if (!onAppWithNewData || onAppWithNewData !== settledOn) { settledOn = onAppWithNewData; settledAt = Date.now(); }
        else if (Date.now() - settledAt >= (opts.settleMs ?? 4_000)) { finished = "back-on-app"; break; }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    // The context outlives its last tab, so this catches cookies set just before the window closed.
    if (browser.isConnected()) state = (await snapshot(ctx, origins)) ?? state;
    if (finished === "logged-in" || finished === "back-on-app") log("Logged in. Saving the session and closing the window.");
  } finally { await browser.close().catch(() => {}); }
  return { state, finished };
}

/**
 * Open a visible browser at the app's login page so a person can sign in however the app works (Google, GitHub,
 * SSO, magic link, 2FA). It finishes by itself once they're logged in and saves only the app's session.
 */
export async function runLogin(root: string, opts: LoginOptions): Promise<LoginResult> {
  const log = opts.log ?? ((s: string) => process.stderr.write(s + "\n"));
  const { cfg, disc, base } = await resolveTarget(root, { iOwnThis: opts.iOwnThis });
  const label = opts.label ?? cfg.accounts[0]?.label ?? "main";
  const start = new URL(opts.url ?? pagesOf(disc).map((p) => p.path).find((p) => LOGIN_PAGE.test(p)) ?? "/", base).href;
  const warnings: string[] = [];
  if (!(await readFile(join(root, ".gitignore"), "utf8").catch(() => "")).includes(".wreck-it")) warnings.push("add .wreck-it/ to .gitignore: the saved session is a live login");
  const candidates = protectedCandidates(cfg.authCheck, pagesOf(disc));

  const { state: raw, finished } = await captureLogin(start, base, await findGate(base, candidates), opts, log);
  const state = raw && appState(raw, base);
  const localStorage = state?.origins.reduce((n, o) => n + o.localStorage.length, 0) ?? 0;
  if (!state || (!state.cookies.length && !localStorage)) throw new WreckError("no session was captured for the app (no cookies or local storage on its origin). Log in fully, then try again", 1);
  const file = authRel(label);
  await writeState(root, file, state);
  await upsertAccount(root, label, file);

  const check = await checkSession(base, state, candidates);
  if (finished === "timeout") warnings.push(`timed out after ${opts.timeoutSec ?? 600}s; saved the session as it was`);
  if (check.status === "expired") warnings.push(`the saved session doesn't open ${check.page}; the login may not have finished`);
  if (check.status === "unknown") warnings.push('no page that requires login was found to verify the session; set "authCheck": "/some-private-page" in .wreck-it/config.json');
  if (localStorage && !state.cookies.length) warnings.push("this app keeps its session in local storage: browsers and generated tests use it, but `perf` and `fuzz` API calls run logged out");
  return { label, file, cookies: state.cookies.length, localStorage, dropped: raw!.cookies.length - state.cookies.length, finished, check, warnings };
}
