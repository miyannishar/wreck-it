import { readFile, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { effectsFor, blockedEffects, EFFECT_WORDS, readDiscovery } from "../context.js";
import { loadConfig } from "../config.js";
import { WreckError } from "../errors.js";
import { addFinding, writeAtomic } from "../findings.js";
import { wreckPaths } from "../paths.js";
import { isAllowedTarget } from "../target.js";
import { formatZodError } from "../schema.js";
import { LoadResultSchema, type LoadProfile, type LoadResult } from "./types.js";
import { findListeningPid, memoryTrend, sampleRssMb, startSampler } from "./memory.js";
import { autocannonBench, isAlive, planPhases, runPhases, type IsAlive, type RunBench } from "./run.js";

export interface LoadOptions {
  url: string; profile: LoadProfile; method?: string; headers?: Record<string, string>; pid?: number;
  stepDuration?: number; maxConnections?: number; soakDuration?: number; recoveryTimeout?: number; iOwnThis?: boolean;
  /** Load-test an endpoint that calls AI models, sends email/SMS or takes payments (thousands of real calls). */
  includeSideEffects?: boolean;
}
export interface LoadDeps {
  runBench: RunBench; isAlive: IsAlive;
  findPid: (url: URL) => Promise<number | null>; sampleRss: (pid: number) => Promise<number | null>;
  warn: (msg: string) => void; sampleEveryMs: number; pollMs: number;
}
export interface LoadOutcome { result: LoadResult; file: string; findingId: string | null; recoveredAfterSec: number | null }

const PROFILES: LoadProfile[] = ["ramp", "spike", "soak"];
const SAFE_METHODS = new Set(["GET", "HEAD"]);

export const loadSlug = (method: string, pathname: string) =>
  `${method}-${pathname === "/" ? "root" : pathname}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "load";

export function parseHeaders(list: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of list) {
    const i = h.indexOf(":");
    if (i <= 0) throw new WreckError(`invalid --header "${h}" (expected "name: value")`, 2);
    out[h.slice(0, i).trim()] = h.slice(i + 1).trim();
  }
  return out;
}

const isLocalHost = (h: string) =>
  !h || h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "[::1]" || h === "0.0.0.0" || /^127\./.test(h) || !h.includes(".");

/** Host of a DATABASE_URL that is not local (docker service names without dots count as local). */
export function remoteDbHost(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (/^(file|sqlite|sqlite3):$/.test(u.protocol)) return null;
    return isLocalHost(u.hostname.toLowerCase()) ? null : u.hostname;
  } catch { return null; }
}

export async function remoteDatabaseWarnings(root: string): Promise<string[]> {
  const out: string[] = [];
  try {
    const d = JSON.parse(await readFile(wreckPaths(root).discovery, "utf8"));
    if (d?.database?.remote === true) out.push(`discovery reports a remote ${d.database.kind ? `${d.database.kind} ` : ""}database`);
  } catch { /* no discovery */ }
  const urls: [string, string][] = process.env.DATABASE_URL ? [["environment", process.env.DATABASE_URL]] : [];
  let names: string[] = [];
  try { names = (await readdir(root)).filter((n) => /^\.env(\..+)?$/.test(n) && !/\.(example|sample|template)$/.test(n)); } catch { /* unreadable root */ }
  for (const n of names.sort()) {
    try {
      const m = /^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)$/m.exec(await readFile(join(root, n), "utf8"));
      if (m) urls.push([n, m[1]!.trim().replace(/^(['"])(.*)\1$/, "$2")]);
    } catch { /* skip */ }
  }
  for (const [src, u] of urls) { const h = remoteDbHost(u); if (h) out.push(`DATABASE_URL in ${src} points at non-local host ${h}`); }
  return out;
}

function positive(name: string, v: number | undefined, def: number): number {
  const n = v ?? def;
  if (!Number.isFinite(n) || n <= 0) throw new WreckError(`${name} must be a positive number`, 2);
  return n;
}

function checkLoadOptions(o: LoadOptions) {
  if (!PROFILES.includes(o.profile)) throw new WreckError(`unknown profile "${o.profile}" (ramp|spike|soak)`, 2);
  if (o.pid !== undefined && !(Number.isInteger(o.pid) && o.pid > 0)) throw new WreckError("--pid must be a positive integer", 2);
  return {
    stepDuration: positive("--step-duration", o.stepDuration, 10), soakDuration: positive("--soak-duration", o.soakDuration, 180),
    maxConnections: Math.floor(positive("--max-connections", o.maxConnections, 500)), recoveryTimeout: positive("--recovery-timeout", o.recoveryTimeout, 30),
  };
}

/** A critical finding for a server that stopped answering under load. */
async function recordCrash(root: string, o: LoadOptions, method: string, url: URL, run: Awaited<ReturnType<typeof runPhases>>, recoveryTimeout: number): Promise<string | null> {
  if (!run.crashed || !run.crashedAt) return null;
  const c = run.crashedAt.connections;
  const { finding } = await addFinding(root, {
    title: `Server crashed under load at ${c} connections`, category: "performance", severity: "critical", persona: "load",
    route: url.pathname || "/", steps: [{ action: "http", method, url: url.href }], reproduced: true,
    expected: `${method} ${url.pathname} keeps responding (or degrades with 503s) under ${c} concurrent connections`,
    actual: `Server stopped accepting connections during the "${run.crashedAt.label}" phase of the ${o.profile} load test and ` +
      (run.recovered ? `came back after ${run.recoveredAfterSec} s.` : `did not recover within ${recoveryTimeout} s.`),
  });
  return finding.id;
}

export async function runLoadTest(root: string, o: LoadOptions, partial: Partial<LoadDeps> = {}): Promise<LoadOutcome> {
  const deps: LoadDeps = {
    runBench: autocannonBench, isAlive, findPid: findListeningPid, sampleRss: sampleRssMb,
    warn: (m) => process.stderr.write(`wreck-it: warning: ${m}\n`), sampleEveryMs: 1000, pollMs: 500, ...partial,
  };
  const { stepDuration, soakDuration, maxConnections, recoveryTimeout } = checkLoadOptions(o);
  const config = await loadConfig(root);
  const target = isAllowedTarget(o.url, { iOwnThis: o.iOwnThis || config.iOwnThis });
  if (!target.ok || !target.url) throw new WreckError(target.reason, 3);
  const url = target.url, method = (o.method ?? "GET").toUpperCase();
  if (!SAFE_METHODS.has(method) && !config.allowMutatingLoad)
    throw new WreckError(`refusing ${method} load test: only GET/HEAD unless "allowMutatingLoad": true in .wreck-it/config.json`, 2);
  const blocked = blockedEffects(config, effectsFor(await readDiscovery(root), method, url.pathname), o.includeSideEffects);
  if (blocked.length)
    throw new WreckError(`refusing to load-test ${method} ${url.pathname}: its handler triggers ${blocked.map((e) => EFFECT_WORDS[e]).join(" and ")}, and a load test sends thousands of requests. Pick another endpoint, or ask the user and add ${JSON.stringify(blocked)} to "allowSideEffects" in .wreck-it/config.json (or pass --include-side-effects)`, 2);
  for (const w of await remoteDatabaseWarnings(root)) deps.warn(`${w}; load testing may hit a shared/production database`);
  if (!(await deps.isAlive(url.href).catch(() => false))) throw new WreckError(`${url.href} is not reachable; start the app first`, 4);

  const pid = o.pid ?? (await deps.findPid(url).catch(() => null));
  const sampler = pid ? startSampler(pid, deps.sampleRss, deps.sampleEveryMs) : null;
  const startedAt = new Date().toISOString();
  let run: Awaited<ReturnType<typeof runPhases>>, samples: { tSec: number; rssMb: number }[] = [];
  try {
    run = await runPhases({
      url: url.href, method, headers: o.headers ?? {}, plan: planPhases(o.profile, { stepDuration, maxConnections, soakDuration }),
      thresholds: config.thresholds, stopOnBreach: o.profile === "ramp", recoveryTimeoutSec: recoveryTimeout,
    }, deps);
  } finally { if (sampler) samples = await sampler.stop(); }

  const parsed = LoadResultSchema.safeParse({
    url: url.href, method, profile: o.profile, startedAt, phases: run.phases, breakingPoint: run.breakingPoint,
    crashed: run.crashed, recovered: run.recovered, memory: samples.length ? memoryTrend(samples) : null,
  } satisfies LoadResult);
  if (!parsed.success) throw new WreckError(`internal: load result failed validation:\n${formatZodError(parsed.error)}`);
  const result = parsed.data as LoadResult;
  const p = wreckPaths(root);
  await mkdir(p.load, { recursive: true });
  const file = join(p.load, `${loadSlug(method, url.pathname)}-${o.profile}.json`);
  await writeAtomic(file, JSON.stringify(result, null, 2) + "\n");

  const findingId = await recordCrash(root, o, method, url, run, recoveryTimeout);
  return { result, file, findingId, recoveredAfterSec: run.recoveredAfterSec };
}

const pad = (s: string | number, n: number) => String(s).padStart(n);

export function formatLoadSummary(o: LoadOutcome): string {
  const r = o.result, lines = [`${r.method} ${r.url} (${r.profile})`, ""];
  lines.push(`${"phase".padEnd(12)}${pad("conns", 6)}${pad("rps", 9)}${pad("p50", 8)}${pad("p90", 8)}${pad("p99", 8)}${pad("errors", 9)}`);
  for (const p of r.phases) {
    lines.push(`${p.label.padEnd(12)}${pad(p.connections, 6)}${pad(p.rps, 9)}${pad(p.latency.p50, 8)}${pad(p.latency.p90, 8)}${pad(p.latency.p99, 8)}${pad(`${(p.errorRate * 100).toFixed(1)}%`, 9)}`);
  }
  lines.push("", "latency in ms; errors = (errors + timeouts + non-2xx) / requests", "");
  const max = Math.max(0, ...r.phases.map((p) => p.connections));
  lines.push(r.breakingPoint ? `Breaking point: ${r.breakingPoint.connections} connections — ${r.breakingPoint.reason}` : `No breaking point found up to ${max} connections`);
  if (r.crashed) lines.push(`CRASHED under load; recovered: ${r.recovered ? `yes (after ${o.recoveredAfterSec} s)` : "no"}${o.findingId ? ` — critical finding ${o.findingId} recorded` : ""}`);
  if (r.memory) {
    const s = r.memory.samples, first = s[0]!, last = s[s.length - 1]!, span = Math.round(last.tSec - first.tSec);
    const range = `${first.rssMb.toFixed(0)} → ${last.rssMb.toFixed(0)} MB RSS over ${span}s`;
    lines.push(span < 60
      ? `Memory: ${range} (too short to judge leaks; use --profile soak)`
      : `Memory: ${range}, ${r.memory.slopeMbPerMin.toFixed(1)} MB/min (${r.memory.leakSuspected ? "leak suspected" : "stable"})`);
  }
  else lines.push("Memory: not sampled (no --pid and no listening process found)");
  lines.push(`Saved ${o.file}`);
  return lines.join("\n") + "\n";
}
