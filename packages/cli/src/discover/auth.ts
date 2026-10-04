import type { AuthKind, Ctx, Discovery, Form } from "./types.js";

const RULES: [AuthKind, RegExp][] = [
  ["next-auth", /^(?:next-auth|@auth\/.+)$/],
  ["clerk", /^@clerk\/.+$/],
  ["supabase", /^@supabase\/(?:supabase-js|ssr|auth-helpers-.+|auth-ui-.+)$/],
  ["lucia", /^(?:lucia|@lucia-auth\/.+)$/],
  ["better-auth", /^better-auth$/],
  ["passport", /^passport(?:-.+)?$/],
  ["jwt", /^(?:jsonwebtoken|jose|@fastify\/jwt|express-jwt|hono-jwt)$/],
  ["custom-session", /^(?:express-session|iron-session|cookie-session|@fastify\/(?:secure-)?session|@fastify\/cookie|cookie-parser|cookies|next-iron-session|hono-sessions)$/],
];

export function detectAuth(deps: Record<string, string>, files: string[], forms: Form[]): Discovery["auth"] {
  const hits = RULES.flatMap(([kind, re]) => Object.keys(deps).filter((d) => re.test(d)).map((d) => ({ kind, d })));
  if (hits.length) return { kind: hits[0]!.kind, evidence: hits.map((h) => `dependency ${h.d} → ${h.kind}`) };
  const evidence = [
    ...files.filter((f) => /(?:^|[/.$_-])(?:login|signin|sign-in|signup|sign-up|register|auth)(?:[/._-]|$)/i.test(f)).slice(0, 5).map((f) => `auth-looking file ${f}`),
    ...forms.filter((f) => f.fields.some((x) => /pass(?:word)?/i.test(x))).slice(0, 5).map((f) => `password field in form ${f.file}:${f.line}`),
  ];
  return evidence.length ? { kind: "unknown", evidence: ["no known auth library in dependencies", ...evidence] } : { kind: "none", evidence: ["no auth library, login route or password field found"] };
}

const SSO: [string, RegExp][] = [
  ["google", /GoogleProvider|providers\/google|GoogleAuthProvider|provider:\s*["'`]google["'`]|signIn(?:\.social)?\(\s*\{?\s*(?:provider:\s*)?["'`]google["'`]|passport-google|@react-oauth\/google|accounts\.google\.com|oauth_google|strategy:\s*["'`]oauth_google/],
  ["github", /GitHubProvider|GithubProvider|providers\/github|GithubAuthProvider|provider:\s*["'`]github["'`]|signIn(?:\.social)?\(\s*\{?\s*(?:provider:\s*)?["'`]github["'`]|passport-github|oauth_github/],
  ["apple", /AppleProvider|providers\/apple|provider:\s*["'`]apple["'`]|oauth_apple/],
  ["microsoft", /AzureADProvider|MicrosoftEntraID|providers\/azure-ad|provider:\s*["'`](?:azure|microsoft)["'`]|oauth_microsoft/],
  ["discord", /DiscordProvider|providers\/discord|provider:\s*["'`]discord["'`]/],
  ["email link", /EmailProvider|providers\/(?:email|nodemailer|resend)|signInWithOtp|sendSignInLinkToEmail|magicLink|magic-link/],
];
const HOSTED: [string, RegExp][] = [
  ["clerk (hosted sign-in)", /^@clerk\//], ["auth0 (hosted sign-in)", /^@auth0\//], ["kinde (hosted sign-in)", /^@kinde-oss\//],
  ["workos (hosted sign-in)", /^@workos-inc\//], ["stytch", /^@?stytch/],
];

/** Sign-in methods a plain email/password form login can't complete. */
export async function detectSso(ctx: Ctx): Promise<string[]> {
  const found = new Set<string>();
  for (const [name, re] of HOSTED) if (Object.keys(ctx.deps).some((d) => re.test(d))) found.add(name);
  const src = ctx.files.filter((f) => /\.(?:[cm]?[jt]sx?|svelte|vue)$/.test(f) && !/(?:^|\/)(?:test|tests|__tests__|e2e)\//.test(f)).slice(0, 1500);
  for (const f of src) {
    const text = await ctx.read(f);
    if (!text) continue;
    for (const [name, re] of SSO) if (!found.has(name) && re.test(text)) found.add(name);
    if (found.size >= SSO.length + HOSTED.length) break;
  }
  return [...found];
}
