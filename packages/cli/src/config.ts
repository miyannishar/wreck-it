import { readFile } from "node:fs/promises";
import { z } from "zod";
import { wreckPaths } from "./paths.js";
import { WreckError } from "./errors.js";
import { formatZodError } from "./schema.js";

/**
 * A test account: email + password for a plain login form, or a saved browser session (`wreck-it login`) for
 * Google/GitHub/SSO, magic links and 2FA. Password accounts get a saved session too, the first time a command logs in.
 */
export const AccountSchema = z.strictObject({
  label: z.string().min(1),
  email: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  storageState: z.string().min(1).optional(),
}).refine((a) => a.storageState || (a.email && a.password), { message: "an account needs email + password, or storageState (run `wreck-it login`)" });
export type Account = z.output<typeof AccountSchema>;

export const ConfigSchema = z.strictObject({
  baseUrl: z.string().url().optional(),
  accounts: z.array(AccountSchema).default([]),
  allowMutatingLoad: z.boolean().default(false),
  iOwnThis: z.boolean().default(false),
  exclude: z.array(z.string()).default([]),
  /**
   * The user agreed that testing may write to the app's remote (hosted) database. Set only after asking them: most
   * vibe-coded apps have one hosted database, and it is usually production.
   */
  allowRemoteDb: z.boolean().default(false),
  /** Side effects the user agreed tests may trigger (each one costs money or reaches real people). */
  allowSideEffects: z.array(z.enum(["ai", "sms", "email", "payments"])).default([]),
  /** An address the user can read, with {n} for a per-use number, e.g. "me+wreck{n}@gmail.com". Used for sign-ups that send email. */
  testEmail: z.string().regex(/\{n\}/, "testEmail needs {n}, e.g. me+wreck{n}@gmail.com").regex(/@/, "testEmail must be an email address").optional(),
  /** A local test inbox (Mailpit, MailHog, Inbucket; Supabase's local stack ships one); probed on common ports when unset. */
  inboxUrl: z.string().url().optional(),
  /** A page that only logged-in users can see, used to check that a saved session still works (default: guessed from discovery). */
  authCheck: z.string().startsWith("/").optional(),
  thresholds: z
    .strictObject({ p99Ms: z.number().positive().default(2000), errorRate: z.number().min(0).max(1).default(0.01) })
    .default({ p99Ms: 2000, errorRate: 0.01 }),
});
export type Config = z.output<typeof ConfigSchema>;

export async function loadConfig(root: string): Promise<Config> {
  const file = wreckPaths(root).config;
  let raw: string;
  try { raw = await readFile(file, "utf8"); } catch { return ConfigSchema.parse({}); }
  let json: unknown;
  try { json = JSON.parse(raw); }
  catch (e) { throw new WreckError(`${file} is not valid JSON: ${(e as Error).message}`); }
  const r = ConfigSchema.safeParse(json);
  if (!r.success) throw new WreckError(`${file} is invalid:\n${formatZodError(r.error)}`);
  return r.data;
}
