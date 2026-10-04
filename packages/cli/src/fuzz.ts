import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { request as pwRequest, type APIRequestContext } from "playwright";
import { launchChromium } from "./browser.js";
import { runCommand } from "./io.js";
import { openSession, saveRefreshed, type Session } from "./auth.js";
import { addFinding, listFindings } from "./findings.js";
import { wreckPaths, ensureDirs } from "./paths.js";
import { resolveTarget, isExcluded, readJson, pagesOf, apisOf, effectsFor, blockedEffects, EFFECT_WORDS, type Target } from "./context.js";
import { recordCreated } from "./run.js";
import type { Api } from "./discover/types.js";
import { WreckError } from "./errors.js";
import type { FindingInput, Step } from "./schema.js";

export type FieldType = "number" | "string" | "boolean";
export interface Seed { method: string; path: string; body?: Record<string, unknown>; query?: Record<string, string>; source: string }
export interface Attempt { method: string; path: string; field: string; mutation: string; status: number; body?: string; url: string }
export interface FuzzResult {
  baseUrl: string; loggedIn: boolean | null; seeds: { method: string; path: string; source: string; baseline: number }[];
  requests: number; serverErrors: { endpoint: string; field: string; mutations: string[]; status: number }[];
  accepted: { endpoint: string; field: string; mutations: string[] }[];
  schemathesis: { ran: boolean; spec?: string; failures: number; note?: string };
  /** Endpoints left alone because they trigger paid or outward-facing work the user hasn't allowed. */
  sideEffectSkips: { endpoint: string; effects: string[] }[];
  /** Requests that succeeded (2xx) on write endpoints: test data now in the app's database. */
  writes: { endpoint: string; count: number }[];
  recorded: string[]; skipped: string[]; warnings: string[];
}

const NUMERIC_NAME = /^(qty|quantity|count|amount|price|total|age|page|limit|offset|size|rating|stars|num|number|days|nights|seats|guests|year|month|day)$/i;
const MUTATING = new Set(["POST", "PUT", "PATCH"]);
/** Mutations that a correct API should reject; a 2xx for these is worth a look. */
const SUSPICIOUS = new Set(["negative", "huge number", "fraction", "text for a number", "empty string", "only spaces", "5,000 characters"]);

/** Body and query fields a route handler reads, guessed from its source. */
export function fieldsIn(src: string): { body: Record<string, FieldType>; query: string[] } {
  const body: Record<string, FieldType> = {};
  const vars = new Set<string>();
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:await\s+)?(?:[\w.]+\.json\(\)|[\w.]*\breadJson\b[^;\n]*|(?:req|request)\.body\b)/g)) vars.add(m[1]!);
  for (const name of ["body", "data", "payload", "input"]) if (new RegExp(`\\b${name}\\s*[?]?\\.\\w`).test(src)) vars.add(name);
  const add = (k: string) => { if (!(k in body) && !/^(then|catch|length|toString)$/.test(k)) body[k] = NUMERIC_NAME.test(k) ? "number" : "string"; };
  // `body.text` is a field; `body.json()` / `data.map(…)` are method calls, not fields.
  for (const v of vars) for (const m of src.matchAll(new RegExp(`\\b${v}\\s*\\??\\.\\s*(\\w+)\\b(?!\\s*\\??\\.?\\()`, "g"))) add(m[1]!);
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?(?:[\w.]+\.json\(\)|[\w.]*\breadJson\b[^;\n]*|(?:req|request)\.body\b|(?:body|data|payload|input)\b)/g))
    for (const part of m[1]!.split(",")) { const k = part.trim().split(/[:=\s]/)[0]; if (k && /^\w+$/.test(k)) add(k); }
  for (const k of Object.keys(body)) {
    const num = new RegExp(`(?:Number|parseInt|parseFloat|Math\\.\\w+)\\(\\s*(?:\\w+\\s*\\??\\.\\s*)?${k}\\b|\\+\\s*(?:\\w+\\??\\.)?${k}\\b`);
    if (num.test(src)) body[k] = "number";
    else if (new RegExp(`(?:\\w+\\??\\.)?${k}\\s*===?\\s*(?:true|false)\\b`).test(src)) body[k] = "boolean";
  }
  const query: string[] = [];
  for (const m of src.matchAll(/searchParams\.get\(\s*["'`](\w+)["'`]\s*\)|(?:req|request)\.query\.(\w+)/g)) { const k = (m[1] ?? m[2])!; if (!query.includes(k)) query.push(k); }
  return { body, query };
}

const sampleValue = (k: string, t: FieldType): unknown => {
  if (t === "number") return 1;
  if (t === "boolean") return true;
  if (/e-?mail/i.test(k)) return "wreck.fuzz.{{unique}}@example.com";
  if (/pass/i.test(k)) return "Passw0rd!wreck";
  if (/phone|tel/i.test(k)) return "5555550100";
  if (/name/i.test(k)) return "Test User";
  if (/code|coupon/i.test(k)) return "TEST";
  if (/url|link/i.test(k)) return "https://example.com";
  return "test";
};

/** Values to try instead of `v`. Each is sent alone, with every other field left at its seed value. */
export function mutationsFor(v: unknown): { label: string; value: unknown }[] {
  const out: { label: string; value: unknown }[] = [];
  if (typeof v === "number") {
    out.push({ label: "negative", value: -1 }, { label: "zero", value: 0 }, { label: "huge number", value: 1e9 }, { label: "fraction", value: 1.5 }, { label: "text for a number", value: "abc" });
  } else if (typeof v === "boolean") {
    out.push({ label: "string for a boolean", value: "yes" });
  } else {
    const s = String(v ?? "");
    out.push(
      { label: "empty string", value: "" }, { label: "only spaces", value: "   " }, { label: "padded with spaces", value: ` ${s} ` },
      { label: "5,000 characters", value: "x".repeat(5000) }, { label: "percent sign", value: "100%" }, { label: "quotes and brackets", value: `'"<>{}` },
      { label: "emoji and accents", value: "Zoë 🙂" }, { label: "number for a string", value: 12345 },
    );
  }
  out.push({ label: "null", value: null }, { label: "missing", value: undefined });
  return out;
}

/** Fill `/x/[id]` style segments, using a real id from a list endpoint when one exists. */
async function realIds(api: APIRequestContext, gets: string[]): Promise<Map<string, unknown>> {
  const ids = new Map<string, unknown>();
  for (const path of gets) {
    if (path.includes("[") || path.includes(":")) continue;
    try {
      const r = await api.get(path, { timeout: 10_000, maxRedirects: 0 });
      if (!r.ok()) continue;
      const j = await r.json();
      const list = Array.isArray(j) ? j : Object.values(j ?? {}).find(Array.isArray);
      const first = Array.isArray(list) ? list.find((x) => x && typeof x === "object" && "id" in x) : undefined;
      if (first) ids.set(path.replace(/\/+$/, "").split("/").pop()!.toLowerCase(), (first as { id: unknown }).id);
    } catch { /* not JSON, or not a list */ }
  }
  return ids;
}

const idFor = (ids: Map<string, unknown>, name: string): unknown => {
  const n = name.toLowerCase().replace(/_?id$/, "");
  return ids.get(n + "s") ?? ids.get(n) ?? ids.get(n + "es");
};

function fillPath(path: string, ids: Map<string, unknown>): string {
  const segs = path.split("/");
  return segs.map((s, i) => {
    const m = /^\[\.{0,3}(\w+)\]$|^:(\w+)$/.exec(s);
    if (!m) return s;
    const v = ids.get((segs[i - 1] ?? "").toLowerCase()) ?? idFor(ids, m[1] ?? m[2]!);
    return encodeURIComponent(String(v ?? "1"));
  }).join("/");
}

const urlOf = (path: string, query?: Record<string, string>) => {
  const q = query && Object.keys(query).length ? "?" + new URLSearchParams(query).toString() : "";
  return path + q;
};

/** `{{unique}}` becomes a fresh value per request (as in generated tests), so sign-ups never collide. */
const unique = (s: string) => s.split("{{unique}}").join(`${Date.now()}${Math.floor(Math.random() * 1000)}`);

async function send(api: APIRequestContext, method: string, url: string, body?: string): Promise<number> {
  if (body !== undefined) body = unique(body);
  try {
    const r = await api.fetch(url, {
      method, timeout: 15_000, maxRedirects: 0, failOnStatusCode: false,
      ...(body !== undefined ? { data: body, headers: { "content-type": "application/json" } } : {}),
    });
    return r.status();
  } catch { return 0; }
}

async function walkSpecs(root: string, dir = "", depth = 0, out: string[] = []): Promise<string[]> {
  if (depth > 4 || out.length) return out;
  let entries: import("node:fs").Dirent[];
  try { entries = await readdir(join(root, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!/^(node_modules|\.git|\.next|dist|build|\.wreck-it|coverage)$/.test(e.name)) await walkSpecs(root, rel, depth + 1, out); }
    else if (/^(openapi|swagger)[\w.-]*\.(json|ya?ml)$/i.test(e.name)) out.push(join(root, rel));
  }
  return out;
}

/** An OpenAPI spec in the repo, or served by the app at a common path. */
export async function findOpenApi(root: string, base: string): Promise<string | undefined> {
  const local = await walkSpecs(root);
  if (local[0]) return local[0];
  for (const p of ["/openapi.json", "/api/openapi.json", "/swagger.json", "/api-docs", "/v3/api-docs", "/docs/openapi.json"]) {
    try {
      const r = await fetch(new URL(p, base), { signal: AbortSignal.timeout(3000), redirect: "manual" });
      if (r.ok && /json/.test(r.headers.get("content-type") ?? "")) {
        const j = await r.json() as Record<string, unknown>;
        if (j && (j.openapi || j.swagger)) return new URL(p, base).href;
      } else await r.body?.cancel().catch(() => {});
    } catch { /* not served */ }
  }
  return undefined;
}

export async function schemathesisCommand(): Promise<string[] | undefined> {
  if ((await runCommand("schemathesis", ["--version"], 20_000)).code === 0) return ["schemathesis"];
  if ((await runCommand("uvx", ["--version"], 20_000)).code === 0) return ["uvx", "schemathesis"];
  return undefined;
}

const unescapeXml = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#10;/g, "\n").replace(/&amp;/g, "&");

/** The failed checks ("- Server error"), falling back to the first line. */
const messageOf = (text: string): string => {
  const lines = text.split("\n").map((x) => x.trim()).filter(Boolean);
  const checks = lines.filter((x) => /^- /.test(x)).map((x) => x.slice(2));
  return (checks.length ? checks.join("; ") : lines[0] ?? "failure").slice(0, 200);
};

/** Failing operations in a Schemathesis JUnit report, with the request from its "Reproduce with" curl command. */
export function parseJunit(xml: string): { operation: string; message: string; method?: string; url?: string; body?: string }[] {
  const out: { operation: string; message: string; method?: string; url?: string; body?: string }[] = [];
  for (const tc of xml.matchAll(/<testcase\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/testcase>/g)) {
    const fail = /<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>|<(failure|error)\b([^>]*)\/>/.exec(tc[2]!);
    if (!fail) continue;
    const text = unescapeXml((fail[3] ?? "") + " " + (/message="([^"]*)"/.exec(fail[2] ?? fail[5] ?? "")?.[1] ?? ""));
    const curl = /curl\s+-X\s+(\w+)([\s\S]*?)\s(https?:\/\/[^\s'"]+)/.exec(text);
    const body = curl ? /-d\s+'((?:[^'\\]|\\.)*)'/.exec(curl[2]!)?.[1] : undefined;
    out.push({
      operation: unescapeXml(tc[1]!), message: messageOf(text),
      ...(curl ? { method: curl[1]!, url: curl[3]! } : {}), ...(body !== undefined ? { body } : {}),
    });
  }
  return out;
}

const describeValue = (v: unknown) => {
  const j = JSON.stringify(v);
  return v === undefined ? "left out" : j.length > 40 ? `${j.slice(0, 37)}…` : j;
};

export interface FuzzOptions {
  baseUrl?: string; seeds?: Seed[]; maxRequests?: number; includeDelete?: boolean; record?: boolean; iOwnThis?: boolean;
  allowRemoteDb?: boolean; schemathesis?: "auto" | "always" | "never"; account?: string;
  /** Fuzz endpoints that trigger AI calls, SMS, email or payments even though config doesn't allow them. */
  includeSideEffects?: boolean;
}
type Variant = { field: string; label: string; url: string; body?: string };
type Suspect = { endpoint: string; field: string; mutations: string[] };
type ServerError = Suspect & { status: number; first: Attempt };
type SchemathesisFailure = { method: string; url: string; body?: string; operation: string; message: string };
/** What one fuzz run has sent and seen so far. */
interface FuzzRun {
  requests: number; attempts: Attempt[]; seedReport: FuzzResult["seeds"];
  serverErrors: Map<string, ServerError>; accepted: Map<string, Suspect>;
}

/** Source of just this endpoint's handler: from its line to the next handler in the same file. */
async function handlerSource(root: string, a: Api, apis: Api[]): Promise<string> {
  let src = "";
  try { src = await readFile(join(root, a.file), "utf8"); } catch { /* file moved */ }
  if (!a.line) return src;
  const next = apis.filter((o) => o.file === a.file && (o.line ?? 0) > a.line!).map((o) => o.line!).sort((x, y) => x - y)[0];
  return src.split("\n").slice(a.line - 1, next ? next - 1 : undefined).join("\n");
}

/** A seed request for one endpoint, with sample values for the fields its handler reads. */
function seedFor(a: Api, m: string, src: string, ids: Map<string, unknown>): Seed | undefined {
  const f = fieldsIn(src);
  if (m === "GET" && !f.query.length) return undefined;
  // Never the real account's credentials: request bodies end up in results.json, findings and generated tests.
  const value = (k: string, t: FieldType) => /id$/i.test(k) ? (idFor(ids, k) ?? sampleValue(k, t)) : sampleValue(k, t);
  const body = MUTATING.has(m) ? Object.fromEntries(Object.entries(f.body).map(([k, t]) => [k, value(k, t)])) : undefined;
  const query = f.query.length ? Object.fromEntries(f.query.map((k) => [k, idFor(ids, k) !== undefined ? String(idFor(ids, k)) : "test"])) : undefined;
  if (MUTATING.has(m) && !Object.keys(body ?? {}).length && !query) return undefined;
  return { method: m, path: a.path, ...(body ? { body } : {}), ...(query ? { query } : {}), source: a.file };
}

// Per path, creates before updates, so PATCH /api/cart finds the item POST /api/cart just added
// (and POST /api/orders, which may empty the cart, runs after both).
const methodOrder = (m: string) => ["GET", "POST", "PUT", "PATCH", "DELETE"].indexOf(m);
const byPathThenMethod = (x: Api, y: Api) => x.path.localeCompare(y.path) || methodOrder(x.method) - methodOrder(y.method);

/** Seeds: requests the agent saved from real use first, then every write endpoint discovery found. */
async function buildSeeds(root: string, t: Target, api: APIRequestContext, opts: FuzzOptions, excluded: (r: string) => boolean, warnings: string[], effectSkips: FuzzResult["sideEffectSkips"]): Promise<{ seeds: Seed[]; ids: Map<string, unknown> }> {
  // Each mutation is a request: ~20 per field. On an endpoint that calls an AI model, sends email/SMS or charges a card,
  // that is real money or real messages, so those wait for the user's go-ahead (config allowSideEffects).
  const blocked = (m: string, path: string) => {
    const b = blockedEffects(t.cfg, effectsFor(t.disc, m, path.split("?")[0]!), opts.includeSideEffects);
    if (b.length && !effectSkips.some((x) => x.endpoint === `${m} ${path}`)) effectSkips.push({ endpoint: `${m} ${path}`, effects: b });
    return b.length > 0;
  };
  const apis = apisOf(t.disc);
  const ids = await realIds(api, apis.filter((a) => a.method === "GET" && !excluded(a.path)).map((a) => a.path));
  const seeds: Seed[] = [...(opts.seeds ?? [])];
  const saved = await readJson(join(t.p.dir, "requests.json"));
  if (Array.isArray(saved)) for (const s of saved) if (s?.method && s?.path) seeds.push({ method: String(s.method).toUpperCase(), path: s.path, body: s.body, query: s.query, source: "requests.json" });
  for (let i = seeds.length - 1; i >= 0; i--) if (blocked(seeds[i]!.method, seeds[i]!.path)) seeds.splice(i, 1);
  const methods = new Set(["GET", ...MUTATING, ...(opts.includeDelete ? ["DELETE"] : [])]);
  for (const a of [...apis].sort(byPathThenMethod)) {
    const m = a.method === "ANY" ? "POST" : a.method;
    if (!methods.has(m) || excluded(a.path) || seeds.some((s) => s.method === m && s.path.split("?")[0] === a.path)) continue;
    if (blocked(m, a.path)) continue;
    const seed = seedFor(a, m, await handlerSource(root, a, apis), ids);
    if (seed) seeds.push(seed);
  }
  if (!seeds.length) warnings.push("no API requests to fuzz: discovery found no write endpoints with readable fields. Save real requests to .wreck-it/requests.json (see `wreck-it fuzz --help`)");
  return { seeds, ids };
}

/** One request per mutated body field, per mutated query parameter, plus two malformed bodies. */
function variantsOf(seed: Seed, path: string, hasBody: boolean): Variant[] {
  const variants: Variant[] = [];
  for (const [k, v] of Object.entries(seed.body ?? {})) for (const mu of mutationsFor(v)) {
    const b = { ...seed.body }; if (mu.value === undefined) delete b[k]; else b[k] = mu.value;
    variants.push({ field: k, label: mu.label, url: urlOf(path, seed.query), body: JSON.stringify(b) });
  }
  for (const [k, v] of Object.entries(seed.query ?? {})) for (const mu of mutationsFor(v)) {
    if (mu.value === null || typeof mu.value === "number") continue;
    const q = { ...seed.query }; if (mu.value === undefined) delete q[k]; else q[k] = String(mu.value);
    variants.push({ field: `?${k}`, label: mu.label, url: urlOf(path, q), ...(hasBody ? { body: JSON.stringify(seed.body ?? {}) } : {}) });
  }
  if (hasBody) variants.push({ field: "(body)", label: "invalid JSON", url: urlOf(path, seed.query), body: "{" }, { field: "(body)", label: "JSON array", url: urlOf(path, seed.query), body: "[]" });
  return variants;
}

/** File a response under server errors (5xx) or accepted-but-suspicious values (2xx for input a correct API rejects). */
function classify(run: FuzzRun, seed: Seed, path: string, baseline: number, v: Variant, at: Attempt): void {
  const key = `${seed.method} ${path} ${v.field}`;
  const endpoint = `${seed.method} ${path}`;
  if (at.status >= 500) {
    const e = run.serverErrors.get(key) ?? { endpoint, field: v.field, mutations: [], status: at.status, first: at };
    e.mutations.push(v.label); run.serverErrors.set(key, e);
  } else if (at.status >= 200 && at.status < 300 && baseline < 300 && SUSPICIOUS.has(v.label) && !v.field.startsWith("?") && v.field !== "(body)") {
    const e = run.accepted.get(key) ?? { endpoint, field: v.field, mutations: [] };
    e.mutations.push(v.label); run.accepted.set(key, e);
  }
}

async function fuzzSeed(api: APIRequestContext, run: FuzzRun, seed: Seed, ids: Map<string, unknown>, max: number, warnings: string[]): Promise<void> {
  const path = fillPath(seed.path, ids);
  const hasBody = MUTATING.has(seed.method) || seed.method === "DELETE";
  const baseline = await send(api, seed.method, urlOf(path, seed.query), hasBody ? JSON.stringify(seed.body ?? {}) : undefined);
  run.requests++;
  run.seedReport.push({ method: seed.method, path, source: seed.source, baseline });
  if (baseline >= 500 || baseline === 0) { warnings.push(`${seed.method} ${path} fails even with normal input (${baseline || "no response"}); mutations skipped`); return; }
  for (const v of variantsOf(seed, path, hasBody)) {
    if (run.requests >= max) break;
    const status = await send(api, seed.method, v.url, v.body);
    run.requests++;
    const at: Attempt = { method: seed.method, path, field: v.field, mutation: v.label, status, url: v.url, ...(v.body !== undefined ? { body: v.body } : {}) };
    run.attempts.push(at);
    classify(run, seed, path, baseline, v, at);
  }
}

async function fuzzSeeds(api: APIRequestContext, seeds: Seed[], ids: Map<string, unknown>, max: number, warnings: string[]): Promise<FuzzRun> {
  const run: FuzzRun = { requests: 0, attempts: [], seedReport: [], serverErrors: new Map(), accepted: new Map() };
  for (const seed of seeds) {
    if (run.requests >= max) { warnings.push(`stopped at --max-requests ${max}`); break; }
    await fuzzSeed(api, run, seed, ids, max, warnings);
  }
  return run;
}

/** Schemathesis, when the app has an OpenAPI spec and Python's uv (or schemathesis) is installed. Fills `schem`. */
/** A Schemathesis path regex matching these routes, whether the spec writes `/x/{id}` or the app writes `/x/[id]`. */
export const pathsRegex = (paths: string[]): string =>
  `^(?:${paths.map((p) => p.split("/").map((s) => (/^\[.+\]$|^:/.test(s) ? "(?:\\{[^}]+\\}|[^/]+)" : s.replace(/[.*+?^${}()|\\[\]]/g, "\\$&"))).join("/")).join("|")})/?$`;

async function runSchemathesis(root: string, t: Target, mode: FuzzOptions["schemathesis"], storageState: Session["state"], schem: FuzzResult["schemathesis"], skipPaths: string[] = []): Promise<SchemathesisFailure[]> {
  if (mode === "never") return [];
  const spec = await findOpenApi(root, t.base);
  if (!spec) { schem.note = "no OpenAPI spec found"; return []; }
  const cmd = await schemathesisCommand();
  if (!cmd) { schem.note = "OpenAPI spec found but Schemathesis is not available; run `npx @miyannishar/wreck-it setup`"; schem.spec = spec; return []; }
  await mkdir(t.p.fuzz, { recursive: true });
  const junit = join(t.p.fuzz, "schemathesis-junit.xml");
  const cookie = storageState?.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const args = [...cmd.slice(1), "run", spec, "--url", t.base, "--checks", "not_a_server_error", "--max-examples", "25",
    "--report", "junit", "--report-junit-path", junit, ...(cookie ? ["--header", `Cookie: ${cookie}`] : []),
    ...(skipPaths.length ? ["--exclude-path-regex", pathsRegex(skipPaths)] : [])];
  const r = await runCommand(cmd[0]!, args, 15 * 60_000);
  schem.ran = true; schem.spec = spec;
  if (r.code === 2) schem.note = `Schemathesis could not run: ${r.out.trim().split("\n").slice(-3).join(" ").slice(0, 300)}`;
  const failures = parseJunit(await readFile(junit, "utf8").catch(() => ""));
  schem.failures = failures.length;
  return failures.flatMap((f) => (f.method && f.url ? [{ method: f.method, url: f.url, body: f.body, operation: f.operation, message: f.message }] : []));
}

const jsonHeaders = { "content-type": "application/json" };

/** A finding that replays one HTTP request and asserts it no longer answers 5xx. */
function httpFinding(req: { method: string; url: string; body?: string }, f: { title: string; route: string; auth?: string; expected: string; actual: string }): FindingInput {
  return {
    title: f.title.slice(0, 200), category: "chaos", severity: "high", persona: "fuzz", route: f.route,
    ...(f.auth ? { auth: f.auth } : {}),
    steps: [{ action: "http", method: req.method, url: req.url, ...(req.body !== undefined ? { headers: jsonHeaders, body: req.body } : {}) }],
    assertions: [{ kind: "httpStatus", below: 500 }],
    expected: f.expected, actual: f.actual, reproduced: false,
  };
}

const serverErrorFinding = (e: ServerError, auth?: string): FindingInput => {
  const a = e.first;
  const field = e.field === "(body)" ? "the request body" : e.field.startsWith("?") ? `query parameter ${e.field.slice(1)}` : e.field;
  const plain = e.field === "(body)" || e.field.startsWith("?");
  const sentValue = plain ? a.mutation : `${a.mutation}: ${describeValue(a.body !== undefined ? (JSON.parse(a.body) as Record<string, unknown>)[e.field] : undefined)}`;
  return httpFinding(a, {
    title: `${e.endpoint} returns ${e.status} when ${field} is ${a.mutation}`, route: a.path, auth,
    expected: `Bad input for ${field} is rejected with a 4xx and a helpful message`,
    actual: `${e.endpoint} answered ${e.status} (server error) for ${field} = ${sentValue}. Also failed for: ${e.mutations.filter((m) => m !== a.mutation).join(", ") || "nothing else"}.`,
  });
};

const schemathesisFinding = (f: SchemathesisFailure, auth?: string): FindingInput => {
  const u = new URL(f.url);
  return httpFinding({ method: f.method, url: u.pathname + u.search, body: f.body }, {
    title: `${f.method} ${u.pathname} returns a server error for generated input (Schemathesis)`, route: u.pathname, auth,
    expected: "Requests that match the OpenAPI spec never cause a server error",
    actual: `Schemathesis (${f.operation}): ${f.message}${f.body ? `. Body: ${f.body.slice(0, 200)}` : ""}`,
  });
};

/** Record every server error and Schemathesis failure, confirming each with a fresh request first. */
async function recordFuzz(root: string, newApi: () => Promise<APIRequestContext>, auth: string | undefined, errors: ServerError[], st: SchemathesisFailure[]): Promise<{ recorded: string[]; skipped: string[] }> {
  const recorded: string[] = [], skipped: string[] = [];
  await ensureDirs(wreckPaths(root));
  const { findings: existing } = await listFindings(root);
  const fresh = await newApi();
  const record = async (input: FindingInput) => {
    const dup = existing.find((f) => f.persona === "fuzz" && f.title === input.title);
    if (dup) { skipped.push(`${dup.id} already records: ${input.title}`); return; }
    const step = input.steps[0] as Extract<Step, { action: "http" }>;
    input.reproduced = (await send(fresh, step.method, step.url, step.body)) >= 500;
    const { finding } = await addFinding(root, input);
    existing.push(finding); recorded.push(finding.id);
  };
  try {
    // Generated tests start from the account's saved session (`auth`), so no password ends up in a test file.
    for (const e of errors) await record(serverErrorFinding(e, auth));
    for (const f of st) await record(schemathesisFinding(f, auth));
  } finally { await fresh.dispose().catch(() => {}); }
  return { recorded, skipped };
}

/** Use the account's session (saved by `wreck-it login`, or a form login) and share its cookies with the API client. */
async function openFuzzSession(root: string, t: Target, account: string | undefined, warnings: string[]): Promise<Session> {
  const browser = await launchChromium();
  try {
    const session = await openSession(browser, root, t.base, pagesOf(t.disc).map((x) => x.path), account);
    warnings.push(...session.warnings.map((w) => w.replace("testing logged out", "fuzzing logged out (protected endpoints will answer 401)")));
    return session;
  } finally { await browser.close().catch(() => {}); }
}

export async function runFuzz(root: string, opts: FuzzOptions): Promise<FuzzResult> {
  const t = await resolveTarget(root, opts);
  if (t.disc?.database?.remote && !opts.allowRemoteDb && !t.cfg.allowRemoteDb)
    throw new WreckError(`the app's ${t.disc.database.kind} database is remote (often the only one, i.e. production) and fuzzing writes test data there. Ask the user; if they agree, set "allowRemoteDb": true in .wreck-it/config.json (or pass --allow-remote-db)`, 3);
  const warnings: string[] = [];
  const sideEffectSkips: FuzzResult["sideEffectSkips"] = [];
  const session = await openFuzzSession(root, t, opts.account, warnings);
  const newApi = () => pwRequest.newContext({ baseURL: t.base, ...(session.state ? { storageState: session.state } : {}) });
  const api = await newApi();
  try {
    const { seeds, ids } = await buildSeeds(root, t, api, opts, (r) => isExcluded(t.cfg, r), warnings, sideEffectSkips);
    const run = await fuzzSeeds(api, seeds, ids, opts.maxRequests ?? 400, warnings);
    const schem: FuzzResult["schemathesis"] = { ran: false, failures: 0 };
    const skipPaths = [...new Set(apisOf(t.disc).filter((a) => blockedEffects(t.cfg, a.effects ?? [], opts.includeSideEffects).length).map((a) => a.path))];
    const st = await runSchemathesis(root, t, opts.schemathesis, session.state, schem, skipPaths);
    if (opts.schemathesis === "always" && !schem.ran) throw new WreckError(`Schemathesis did not run: ${schem.note}`, 1);
    const auth = session.state ? session.label : undefined;
    const writeCounts = new Map<string, number>();
    for (const a of run.attempts) if (MUTATING.has(a.method) && a.status >= 200 && a.status < 300) writeCounts.set(`${a.method} ${a.path}`, (writeCounts.get(`${a.method} ${a.path}`) ?? 0) + 1);
    const writes = [...writeCounts].map(([endpoint, count]) => ({ endpoint, count }));
    for (const w of writes) await recordCreated(root, { by: "fuzz", what: `${w.count} accepted request(s) to ${w.endpoint}`, count: w.count });
    const { recorded, skipped } = opts.record ? await recordFuzz(root, newApi, auth, [...run.serverErrors.values()], st) : { recorded: [], skipped: [] };
    const result: FuzzResult = {
      baseUrl: t.base, loggedIn: session.loggedIn, seeds: run.seedReport, requests: run.requests,
      serverErrors: [...run.serverErrors.values()].map(({ first: _f, ...e }) => e),
      accepted: [...run.accepted.values()], schemathesis: schem, sideEffectSkips, writes, recorded, skipped, warnings,
    };
    await mkdir(t.p.fuzz, { recursive: true });
    await writeFile(join(t.p.fuzz, "results.json"), JSON.stringify({ ...result, attempts: run.attempts }, null, 2));
    return result;
  } finally {
    if (session.state) await saveRefreshed(root, t.base, session.label, await api.storageState().catch(() => session.state!)).catch(() => {});
    await api.dispose().catch(() => {});
  }
}

export function formatFuzz(r: FuzzResult): string {
  const l = [`fuzzed ${r.seeds.length} endpoint(s) with ${r.requests} requests on ${r.baseUrl}${r.loggedIn === null ? "" : r.loggedIn ? " (logged in)" : " (login failed)"}`];
  for (const s of r.seeds) l.push(`  ${s.method} ${s.path}  normal input → ${s.baseline || "no response"}  (${s.source})`);
  if (r.serverErrors.length) l.push("", "server errors (recorded with --record):");
  for (const e of r.serverErrors) l.push(`  ${e.endpoint}  ${e.field}: ${e.mutations.join(", ")} → ${e.status}`);
  if (r.accepted.length) l.push("", "accepted values a correct API would probably reject (judge these yourself, e.g. check the UI after a negative quantity):");
  for (const a of r.accepted) l.push(`  ${a.endpoint}  ${a.field}: ${a.mutations.join(", ")}`);
  if (r.sideEffectSkips.length) l.push("", "not fuzzed, because they'd trigger paid or real-world side effects (allow with config allowSideEffects or --include-side-effects):");
  for (const s of r.sideEffectSkips) l.push(`  ${s.endpoint}  ${s.effects.map((e) => EFFECT_WORDS[e as keyof typeof EFFECT_WORDS] ?? e).join(", ")}`);
  if (r.writes.length) l.push("", `test data written: ${r.writes.map((w) => `${w.count}× ${w.endpoint}`).join(", ")} (listed in the report for cleanup)`);
  l.push("", `schemathesis: ${r.schemathesis.ran ? `ran on ${r.schemathesis.spec}, ${r.schemathesis.failures} failing operation(s)` : "skipped"}${r.schemathesis.note ? ` (${r.schemathesis.note})` : ""}`);
  if (r.recorded.length) l.push("", `recorded: ${r.recorded.join(", ")}`);
  for (const s of r.skipped) l.push(`skipped: ${s}`);
  for (const w of r.warnings) l.push(`warning: ${w}`);
  return l.join("\n") + "\n";
}
