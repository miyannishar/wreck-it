import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isAllowedTarget } from "./target.js";
import { loadTarget, readJson } from "./context.js";
import { sessionStatus } from "./auth.js";
import { findInbox } from "./email.js";
import { mcpSources } from "./setup.js";

export interface PreflightResult {
  url: string; allowed: boolean; reason: string; reachable: boolean; status?: number; devScript?: string;
  playwrightMcp: { found: boolean; sources: string[] };
  /** The first account's saved session (from `wreck-it login`), checked against a login-only page. */
  session?: { label?: string; status: "valid" | "expired" | "missing" | "unknown"; page?: string };
  /**
   * What testing touches beyond the app. `ask` holds the questions to put to the user before any stage that writes:
   * a remote (likely production) database, live payments, email without a readable inbox, paid AI/SMS calls.
   */
  safety: { remoteDb?: string; sideEffects: string[]; email: "inbox" | "testEmail" | "none" | "not-used"; ask: string[] };
  warnings: string[];
}

export async function checkReachable(url: string, waitSec: number): Promise<{ reachable: boolean; status?: number }> {
  const deadline = Date.now() + waitSec * 1000;
  for (;;) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: "manual" });
      await r.body?.cancel().catch(() => {});
      return { reachable: true, status: r.status };
    } catch { /* retry */ }
    if (Date.now() + 500 > deadline) return { reachable: false };
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function safetyOf(t: Awaited<ReturnType<typeof loadTarget>>): Promise<PreflightResult["safety"]> {
  const { cfg, disc } = t;
  const svc = disc?.services;
  const uses = svc?.uses ?? [];
  const email = !uses.includes("email") ? "not-used" : (await findInbox(cfg).catch(() => undefined)) ? "inbox" : cfg.testEmail ? "testEmail" : "none";
  const remoteDb = disc?.database?.remote ? `${disc.database.kind}${disc.database.url ? ` (${disc.database.url})` : ""}` : undefined;
  const ask: string[] = [];
  if (remoteDb && !cfg.allowRemoteDb)
    ask.push(`The app uses a hosted ${remoteDb} database, and testing creates accounts and data there. Is it a dev/test project, or production (then better: point the app at a dev project or Supabase branch first)? If they say go ahead, set "allowRemoteDb": true in .wreck-it/config.json.`);
  if (svc?.stripeMode === "live")
    ask.push("Stripe LIVE keys are configured, so a completed checkout is a real charge. Ask the user to switch to test keys (sk_test_/pk_test_); until then never submit a payment.");
  if (email === "none")
    ask.push('The app sends email (sign-up confirmation, resets, invites) and there is no local test inbox. Ask for an address they can read and set "testEmail" with {n} (e.g. "me+wreck{n}@gmail.com"). Never sign up with example.com: bounces get email sending throttled.');
  const paid = uses.filter((e) => (e === "ai" || e === "sms") && !cfg.allowSideEffects.includes(e));
  if (paid.length)
    ask.push(`The app calls ${paid.map((e) => (e === "ai" ? "AI models (paid per call)" : "an SMS service (real texts)")).join(" and ")}. fuzz and load skip those endpoints, and the browser triggers them only a few times. If the user is fine with more, add ${JSON.stringify(paid)} to "allowSideEffects".`);
  return { ...(remoteDb ? { remoteDb } : {}), sideEffects: uses, email, ask };
}

export async function runPreflight(opts: { root: string; url?: string; iOwnThis?: boolean; wait?: number }): Promise<PreflightResult> {
  const { root } = opts;
  const t = await loadTarget(root, opts.url);
  const { cfg, disc } = t;
  const url = t.base;
  const check = isAllowedTarget(url, { iOwnThis: opts.iOwnThis || cfg.iOwnThis });
  const warnings: string[] = [];
  const pkg = await readJson<{ scripts?: Record<string, string> }>(join(root, "package.json"));
  const devScript = disc?.devScript ?? (pkg?.scripts?.dev ? "npm run dev" : undefined);
  if (!(await readFile(join(root, ".gitignore"), "utf8").catch(() => "")).includes(".wreck-it")) warnings.push(".gitignore does not mention .wreck-it/ (findings, screenshots and saved logins may be committed)");
  const sources = await mcpSources(root, /playwright/i);
  if (!sources.length) warnings.push("Playwright MCP not found in any agent config; run `npx @miyannishar/wreck-it setup --dry-run`, then `setup`");

  const net = check.ok ? await checkReachable(url, opts.wait ?? 0) : { reachable: false };
  if (check.ok && !net.reachable) warnings.push(devScript ? `app not reachable at ${url}; start it with: ${devScript}` : `app not reachable at ${url}`);
  let session: PreflightResult["session"];
  const acct = cfg.accounts[0];
  if (acct?.storageState && net.reachable) {
    session = await sessionStatus(root).catch(() => ({ label: acct.label, status: "unknown" as const }));
    if (session.status === "expired" || session.status === "missing")
      warnings.push(`saved session for "${acct.label}" is ${session.status}; run \`wreck-it login --label ${acct.label}\` (it opens a browser for the user to sign in)`);
  }
  if (disc?.auth?.sso?.length && !cfg.accounts.some((a) => a.storageState))
    warnings.push(`the app signs in with ${disc.auth.sso.join(", ")}; run \`wreck-it login\` so the user signs in once and wreck-it can test logged in`);
  const safety = await safetyOf(t);
  if (disc?.services?.captcha) warnings.push("the app uses a CAPTCHA: flows behind it are blocked unless it uses test keys locally; report them as 'blocked by CAPTCHA', not as bugs");
  for (const q of safety.ask) warnings.push(`ask the user: ${q}`);
  return {
    url, allowed: check.ok, reason: check.reason, reachable: net.reachable, ...("status" in net ? { status: net.status } : {}),
    ...(devScript ? { devScript } : {}), playwrightMcp: { found: sources.length > 0, sources }, ...(session ? { session } : {}), safety, warnings,
  };
}

export const preflightExitCode = (r: PreflightResult): number => (!r.allowed ? 3 : !r.reachable ? 4 : 0);

export function formatPreflight(r: PreflightResult): string {
  const l = [
    `target     ${r.url}  ${r.allowed ? "allowed" : "REFUSED"} (${r.reason})`,
    `reachable  ${r.reachable ? `yes (HTTP ${r.status})` : "no"}`,
    `dev script ${r.devScript ?? "unknown"}`,
    `playwright MCP  ${r.playwrightMcp.found ? `found in ${r.playwrightMcp.sources.join(", ")}` : "not found"}`,
    ...(r.session ? [`session    ${r.session.label}: ${r.session.status}${r.session.page ? ` (checked ${r.session.page})` : ""}`] : []),
    `data       ${r.safety.remoteDb ? `remote ${r.safety.remoteDb}` : "local or unknown database"}`,
    ...(r.safety.sideEffects.length ? [`effects    ${r.safety.sideEffects.join(", ")}; email: ${r.safety.email}`] : []),
    ...r.warnings.map((w) => `warning: ${w}`),
  ];
  return l.join("\n") + "\n";
}
