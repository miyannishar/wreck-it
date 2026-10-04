import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isAllowedTarget } from "../target.js";
import type { Discovery } from "./types.js";

const ENV_FILES = [".env", ".env.development", ".env.local"]; // later files override earlier ones
const KEYS = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "MONGODB_URI", "MONGO_URL", "MYSQL_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "VITE_SUPABASE_URL", "PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_URL"];
const FIREBASE = ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", "VITE_FIREBASE_PROJECT_ID", "FIREBASE_PROJECT_ID", "PUBLIC_FIREBASE_PROJECT_ID"];

export function parseEnv(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of src.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][\w.]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2]!;
    const q = /^(["'`])([\s\S]*)\1$/.exec(v);
    v = q ? q[2]! : v.replace(/\s+#.*$/, "");
    out[m[1]!] = v;
  }
  return out;
}

/** Strip userinfo passwords and secret-looking query params. */
export function redactUrl(u: string): string {
  return u
    .replace(/^([a-z][\w+.-]*:\/\/[^:/@?#]*):.*@/i, "$1:***@")
    .replace(/([?&](?:password|pass|pwd|token|secret|key|apikey|api_key|auth_token|authToken|sslpassword)=)[^&#]*/gi, "$1***");
}

const kindOf = (key: string, proto: string, host: string): string => {
  if (/^postgres(?:ql)?$/.test(proto)) return host.endsWith(".supabase.co") || host.endsWith(".supabase.com") ? "postgres (supabase)" : "postgres";
  if (/^mongodb(?:\+srv)?$/.test(proto)) return "mongodb";
  if (/^mysql2?$/.test(proto)) return "mysql";
  if (proto === "file" || proto === "sqlite") return "sqlite";
  if (proto === "libsql") return "libsql";
  if (/SUPABASE/.test(key)) return "supabase";
  return proto || "unknown";
};

/** Loopback/private (via isAllowedTarget), `.local`/`.internal`, or a dotless docker-compose service name ("db"). */
const isLocalHost = (h: string): boolean =>
  !h || isAllowedTarget(`http://${h}`).ok || /\.(?:local|internal)$/.test(h) || (!h.includes(".") && !h.startsWith("["));

export async function detectDatabase(root: string): Promise<Discovery["database"]> {
  const env: Record<string, string> = {};
  for (const f of ENV_FILES) {
    try { Object.assign(env, parseEnv(await readFile(join(root, f), "utf8"))); } catch { /* missing */ }
  }
  const key = KEYS.find((k) => env[k]);
  if (!key) {
    // Firebase has no connection URL: a project id means the hosted project, unless the emulators are configured.
    const fb = FIREBASE.find((k) => env[k]);
    return fb ? { kind: "firebase", url: `firebase project ${env[fb]}`, remote: !env.FIRESTORE_EMULATOR_HOST && !env.FIREBASE_AUTH_EMULATOR_HOST } : undefined;
  }
  const raw = env[key]!;
  const pm = /^([a-z][\w+.-]*):/i.exec(raw);
  const proto = pm ? pm[1]!.toLowerCase() : "";
  if (!proto || proto === "file" || proto === "sqlite")
    return { kind: proto || /\.(?:db|sqlite3?)$/.test(raw) ? "sqlite" : "unknown", url: redactUrl(raw), remote: false };
  const hosts = (/^[a-z][\w+.-]*:\/\/(?:.*@)?([^/?#@]*)/i.exec(raw)?.[1] ?? "").split(",").map((h) => h.replace(/:\d+$/, "").toLowerCase());
  const remote = proto === "mongodb+srv" || hosts.some((h) => !isLocalHost(h));
  return { kind: kindOf(key, proto, hosts[0] ?? ""), url: redactUrl(raw), remote };
}
