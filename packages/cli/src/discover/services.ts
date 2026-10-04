import { readFile } from "node:fs/promises";
import { join, dirname, posix } from "node:path";
import { parseEnv } from "./database.js";
import type { Api, Ctx, Discovery } from "./types.js";

/** Side effects that cost money or reach real people when a test triggers them. */
export const SIDE_EFFECTS = ["ai", "sms", "email", "payments"] as const;
export type SideEffect = (typeof SIDE_EFFECTS)[number];

const DEPS: Record<SideEffect, RegExp> = {
  ai: /^(?:openai|@anthropic-ai\/sdk|ai|@ai-sdk\/.+|@google\/generative-ai|@google\/genai|groq-sdk|replicate|@mistralai\/mistralai|cohere-ai|langchain|@langchain\/.+|together-ai|@fal-ai\/.+|elevenlabs|@elevenlabs\/.+|@huggingface\/inference|ollama)$/,
  sms: /^(?:twilio|@vonage\/.+|messagebird|plivo|@sinch\/.+)$/,
  email: /^(?:resend|@sendgrid\/mail|nodemailer|postmark|mailgun\.js|@aws-sdk\/client-sesv?2?|@mailchimp\/.+|loops|@react-email\/render|@plunk\/node)$/,
  payments: /^(?:stripe|@stripe\/stripe-js|@lemonsqueezy\/.+|@paddle\/.+|@polar-sh\/.+|razorpay|@paypal\/.+)$/,
};
/** In handler source: SDK imports, API hosts, and auth calls that email the user. */
const CODE: Record<SideEffect, RegExp> = {
  ai: /from\s+["'](?:openai|@anthropic-ai\/sdk|ai|@ai-sdk\/[\w-]+|@google\/generative-ai|@google\/genai|groq-sdk|replicate|@mistralai\/mistralai|cohere-ai|@langchain\/[\w-]+|langchain[\w/-]*|@fal-ai\/[\w-]+)["']|api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.groq\.com|openrouter\.ai/,
  sms: /from\s+["'](?:twilio|@vonage\/[\w-]+|plivo)["']|require\(["']twilio["']\)|api\.twilio\.com/,
  email: /from\s+["'](?:resend|@sendgrid\/mail|nodemailer|postmark|mailgun\.js|@aws-sdk\/client-sesv?2?|loops)["']|api\.resend\.com|api\.sendgrid\.com|auth\.(?:signUp|resetPasswordForEmail|signInWithOtp|admin\.inviteUserByEmail)\(|sendSignInLinkToEmail|sendPasswordResetEmail|sendEmailVerification/,
  // SDK imports, API hosts and Stripe calls only: plain words like "paddle" or "charges" appear in ordinary product data.
  payments: /from\s+["'](?:stripe|@lemonsqueezy\/[\w-]+|@paddle\/[\w-]+|@polar-sh\/[\w-]+)["']|require\(["']stripe["']\)|\bstripe\.(?:checkout|paymentIntents|charges|subscriptions|invoices)\.|api\.(?:stripe|lemonsqueezy|paddle)\.com/,
};
const CAPTCHA = /challenges\.cloudflare\.com\/turnstile|react-turnstile|hcaptcha|react-google-recaptcha|google\.com\/recaptcha|recaptcha\/api/i;

export interface Services {
  /** App-wide: which side-effect kinds the app uses at all. */
  uses: SideEffect[];
  /** Stripe keys in the env files: "live" means real charges. */
  stripeMode?: "live" | "test";
  captcha?: boolean;
  /** Supabase local config says sign-ups must confirm their email (hosted projects default to the same). */
  emailConfirmation?: boolean;
}

const ENV_FILES = [".env", ".env.development", ".env.local"];

async function envOf(root: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const f of ENV_FILES) { try { Object.assign(env, parseEnv(await readFile(join(root, f), "utf8"))); } catch { /* missing */ } }
  return env;
}

/** Relative and `@/`-alias imports of a source file, resolved to files in the scan. */
function localImports(src: string, from: string, files: Set<string>): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/(?:from|import\()\s*["']((?:\.{1,2}\/|@\/|~\/)[^"']+)["']/g)) {
    const spec = m[1]!;
    const bases = spec.startsWith("@/") || spec.startsWith("~/") ? [spec.slice(2), `src/${spec.slice(2)}`] : [posix.normalize(posix.join(dirname(from), spec))];
    for (const b of bases) {
      const hit = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"].map((e) => b + e).find((c) => files.has(c));
      if (hit) { out.push(hit); break; }
    }
  }
  return out;
}

/** Side effects a file triggers, following local imports two levels deep (route → lib/ai.ts → openai). */
async function effectsOf(ctx: Ctx, file: string, files: Set<string>, seen = new Set<string>(), depth = 0): Promise<Set<SideEffect>> {
  const out = new Set<SideEffect>();
  if (seen.has(file) || depth > 2) return out;
  seen.add(file);
  const src = await ctx.read(file);
  for (const k of SIDE_EFFECTS) if (CODE[k].test(src)) out.add(k);
  for (const dep of localImports(src, file, files)) for (const k of await effectsOf(ctx, dep, files, seen, depth + 1)) out.add(k);
  return out;
}

/** Mark each API route with the paid or outward-facing side effects its handler can trigger. */
export async function markApis(ctx: Ctx, api: Api[]): Promise<(Api & { effects?: SideEffect[] })[]> {
  const files = new Set(ctx.files);
  const cache = new Map<string, SideEffect[]>();
  const out: (Api & { effects?: SideEffect[] })[] = [];
  for (const a of api) {
    if (!cache.has(a.file)) cache.set(a.file, [...(await effectsOf(ctx, a.file, files))]);
    const effects = cache.get(a.file)!;
    out.push(effects.length ? { ...a, effects } : a);
  }
  return out;
}

export async function detectServices(ctx: Ctx): Promise<Discovery["services"]> {
  const uses = SIDE_EFFECTS.filter((k) => Object.keys(ctx.deps).some((d) => DEPS[k].test(d)));
  const env = await envOf(ctx.root);
  const keys = Object.entries(env).filter(([k]) => /STRIPE/i.test(k)).map(([, v]) => v);
  const stripeMode = keys.some((v) => /^(?:sk|pk|rk)_live_/.test(v)) ? "live" : keys.some((v) => /^(?:sk|pk|rk)_test_/.test(v)) ? "test" : undefined;
  if (stripeMode && !uses.includes("payments")) uses.push("payments");
  let captcha = Object.keys(ctx.deps).some((d) => /turnstile|hcaptcha|recaptcha/i.test(d));
  if (!captcha) for (const f of ctx.files.filter((x) => /\.(?:[cm]?[jt]sx?|svelte|vue|html)$/.test(x)).slice(0, 1500)) if (CAPTCHA.test(await ctx.read(f))) { captcha = true; break; }
  const supa = await ctx.read("supabase/config.toml");
  const confirm = /\[auth\.email\][^[]*enable_confirmations\s*=\s*(true|false)/.exec(supa)?.[1];
  const usesSupabase = Object.keys(ctx.deps).some((d) => d.startsWith("@supabase/"));
  const s: Services = {
    uses,
    ...(stripeMode ? { stripeMode } : {}),
    ...(captcha ? { captcha } : {}),
    // Hosted Supabase projects confirm sign-up emails by default; the local config says so explicitly.
    ...(confirm ? { emailConfirmation: confirm === "true" } : usesSupabase ? { emailConfirmation: true } : {}),
  };
  if (usesSupabase && !uses.includes("email")) s.uses = [...uses, "email"];
  return s;
}

/** Supabase/Firebase projects hardcoded in source (Lovable-style apps keep the project URL in a client file, not .env). */
export async function hardcodedBackend(ctx: Ctx): Promise<Discovery["database"] | undefined> {
  for (const f of ctx.files.filter((x) => /\.(?:[cm]?[jt]sx?)$/.test(x) && /supabase|firebase|client|config|lib|integrations/i.test(x)).slice(0, 400)) {
    const src = await ctx.read(f);
    const supa = /https:\/\/([a-z0-9]{20})\.supabase\.(?:co|com)/.exec(src);
    if (supa) return { kind: "supabase", url: `https://${supa[1]}.supabase.co`, remote: true };
    if (/initializeApp\(\s*\{[^}]*projectId/s.test(src) && !/connect(?:Firestore|Auth|Database)Emulator/.test(src)) return { kind: "firebase", remote: true };
  }
  return undefined;
}
