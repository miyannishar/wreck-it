export const FRAMEWORKS = ["nextjs-app", "nextjs-pages", "express", "fastify", "hono", "react-router", "sveltekit", "remix"] as const;
export type Framework = (typeof FRAMEWORKS)[number];
export const AUTH_KINDS = ["none", "next-auth", "clerk", "supabase", "lucia", "better-auth", "passport", "custom-session", "jwt", "unknown"] as const;
export type AuthKind = (typeof AUTH_KINDS)[number];

export interface Page { path: string; file: string; dynamic: boolean }
export interface Api { method: string; path: string; file: string; line?: number; /** Paid or outward-facing work the handler can trigger. */ effects?: ("ai" | "sms" | "email" | "payments")[] }
export interface Form { file: string; line: number; fields: string[]; action?: string }

export interface Discovery {
  generatedAt: string;
  frameworks: Framework[];
  baseUrl?: string;
  devScript?: string;
  pages: Page[];
  api: Api[];
  forms: Form[];
  /** `sso`: sign-in methods a form login can't automate (Google, GitHub, hosted pages, email links); use `wreck-it login`. */
  auth: { kind: AuthKind; evidence: string[]; sso?: string[] };
  database?: { kind: string; url?: string; remote: boolean };
  /** Paid or outward-facing services (AI, SMS, email, payments), live payment keys, CAPTCHAs, email confirmation. */
  services?: { uses: ("ai" | "sms" | "email" | "payments")[]; stripeMode?: "live" | "test"; captcha?: boolean; emailConfirmation?: boolean };
  warnings: string[];
}

export interface Pkg { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

/** Shared scan context: posix-relative file list, merged deps, cached reads. */
export interface Ctx {
  root: string;
  files: string[];
  deps: Record<string, string>;
  pkg: Pkg;
  read(file: string): Promise<string>;
  warn(msg: string): void;
}

export interface Routes { pages: Page[]; api: Api[] }

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export const lineAt = (src: string, idx: number): number => src.slice(0, idx).split("\n").length;
export const page = (path: string, file: string): Page => ({ path, file, dynamic: path.includes("[") });
export const toPath = (segs: string[]): string => "/" + segs.filter(Boolean).join("/");

/** Exported HTTP-method handlers (`export async function GET`, `export const POST =`, `export { GET, POST }`). */
export function exportedMethods(src: string): { method: string; line: number }[] {
  const out: { method: string; line: number }[] = [];
  const m = /export\s+(?:async\s+)?(?:function\s*\*?|const|let|var)\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
  for (const x of src.matchAll(m)) out.push({ method: x[1]!, line: lineAt(src, x.index!) });
  for (const x of src.matchAll(/export\s*\{([^}]*)\}/g))
    for (const name of x[1]!.split(",").map((s) => s.trim().split(/\s+as\s+/).pop()!.trim()))
      if ((METHODS as readonly string[]).includes(name) && !out.some((o) => o.method === name)) out.push({ method: name, line: lineAt(src, x.index!) });
  return out;
}
