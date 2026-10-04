import type { AuthKind, Discovery, Form } from "./types.js";

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
