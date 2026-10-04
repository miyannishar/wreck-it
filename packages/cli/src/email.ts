import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, type Config } from "./config.js";
import { wreckPaths } from "./paths.js";
import { WreckError } from "./errors.js";

export type InboxKind = "mailpit" | "inbucket";
export interface Inbox { kind: InboxKind; url: string }
export interface Mail { subject: string; text: string; links: string[]; receivedAt?: string }

/** Where local test inboxes usually listen: Mailpit (8025), Supabase's local stack (54324), Inbucket (9000). */
const DEFAULT_INBOXES = ["http://127.0.0.1:8025", "http://127.0.0.1:54324", "http://127.0.0.1:9000"];

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

/** The local test inbox, if one is running (config inboxUrl, or the usual ports). */
export async function findInbox(cfg: Config): Promise<Inbox | undefined> {
  for (const base of cfg.inboxUrl ? [cfg.inboxUrl] : DEFAULT_INBOXES) {
    const url = base.replace(/\/+$/, "");
    try { const j = await getJson(`${url}/api/v1/info`); if (j && ("Version" in j || "Messages" in j)) return { kind: "mailpit", url }; } catch { /* not mailpit */ }
    try { const j = await getJson(`${url}/api/v1/mailbox/wreck-it-probe`); if (Array.isArray(j)) return { kind: "inbucket", url }; } catch { /* not inbucket */ }
  }
  return undefined;
}


/** Links in a mail, confirmation-looking ones first. */
export function linksIn(text: string): string[] {
  const all = [...new Set([...text.replace(/&amp;/g, "&").matchAll(/https?:\/\/[^\s"'<>)\]]+/g)].map((m) => m[0]!.replace(/[.,;]+$/, "")))];
  const score = (u: string) => (/(confirm|verif|token|magic|callback|auth|reset|invite|login|otp)/i.test(u) ? 0 : 1);
  return all.sort((a, b) => score(a) - score(b));
}

/** The newest mail to `to` in the inbox, or undefined. */
export async function latestMail(inbox: Inbox, to: string): Promise<Mail | undefined> {
  if (inbox.kind === "mailpit") {
    const list = await getJson(`${inbox.url}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=1`);
    const m = list?.messages?.[0];
    if (!m) return undefined;
    const full = await getJson(`${inbox.url}/api/v1/message/${encodeURIComponent(m.ID)}`);
    const text = `${full.Text ?? ""}\n${full.HTML ?? ""}`;
    return { subject: full.Subject ?? m.Subject ?? "", text: (full.Text ?? "").slice(0, 2000), links: linksIn(text), receivedAt: m.Created };
  }
  const box = to.split("@")[0]!;
  const list = await getJson(`${inbox.url}/api/v1/mailbox/${encodeURIComponent(box)}`);
  const m = Array.isArray(list) ? list[list.length - 1] : undefined;
  if (!m) return undefined;
  const full = await getJson(`${inbox.url}/api/v1/mailbox/${encodeURIComponent(box)}/${encodeURIComponent(m.id)}`);
  const text = `${full.body?.text ?? ""}\n${full.body?.html ?? ""}`;
  return { subject: full.subject ?? m.subject ?? "", text: (full.body?.text ?? "").slice(0, 2000), links: linksIn(text), receivedAt: m.date };
}

/** Wait up to `waitSec` for a mail to `to`. */
export async function readMail(root: string, to: string, waitSec = 30): Promise<{ inbox: Inbox; mail?: Mail }> {
  const cfg = await loadConfig(root);
  const inbox = await findInbox(cfg);
  if (!inbox) throw new WreckError('no local test inbox found (Mailpit on :8025, Supabase local on :54324, Inbucket on :9000). Set "inboxUrl" in .wreck-it/config.json, or ask the user to open the email', 1);
  const deadline = Date.now() + waitSec * 1000;
  for (;;) {
    const mail = await latestMail(inbox, to).catch(() => undefined);
    if (mail || Date.now() >= deadline) return { inbox, ...(mail ? { mail } : {}) };
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/**
 * A fresh address for a sign-up or invite. With testEmail ("me+wreck{n}@gmail.com") mail reaches the user; with a
 * local inbox any address works. Never example.com when the app really sends email: those bounce, and providers
 * (Supabase's built-in email, Resend, SendGrid) throttle or suspend senders with many bounces.
 */
export async function nextTestEmail(root: string): Promise<{ address: string; readable: "inbox" | "user" }> {
  const cfg = await loadConfig(root);
  const file = join(wreckPaths(root).dir, "email-counter");
  const n = (Number((await readFile(file, "utf8").catch(() => "0")).trim()) || 0) + 1;
  await mkdir(wreckPaths(root).dir, { recursive: true });
  await writeFile(file, String(n));
  if (cfg.testEmail) return { address: cfg.testEmail.replace("{n}", `${Date.now().toString(36)}${n}`), readable: "user" };
  if (await findInbox(cfg)) return { address: `wreck.tester+${Date.now().toString(36)}${n}@example.test`, readable: "inbox" };
  throw new WreckError('no safe address for emails: set "testEmail" in .wreck-it/config.json to an address the user can read, with {n} (e.g. "me+wreck{n}@gmail.com"), or run a local test inbox. Example.com addresses bounce, and bounces get email sending throttled', 1);
}
