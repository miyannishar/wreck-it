import autocannon from "autocannon";
import { connect } from "node:net";
import { WreckError } from "../errors.js";
import type { BenchResult, LoadProfile, LoadResult, PhaseResult } from "./types.js";

export interface BenchOptions { url: string; method: string; headers: Record<string, string>; connections: number; durationSec: number }
export type RunBench = (o: BenchOptions) => Promise<BenchResult>;
export type IsAlive = (url: string) => Promise<boolean>;
export interface PhasePlan { label: string; connections: number; durationSec: number; judged: boolean }
export interface Thresholds { p99Ms: number; errorRate: number }

export const RAMP_CONNECTIONS = [10, 25, 50, 100, 200, 350, 500];
const fin = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

export const autocannonBench: RunBench = async (o) => {
  const r = await autocannon({
    url: o.url, method: o.method as autocannon.Request["method"], headers: o.headers,
    connections: o.connections, duration: o.durationSec, timeout: 10,
  });
  return {
    requests: fin(r.requests.total), rps: r1(fin(r.requests.average)),
    latency: { p50: fin(r.latency.p50), p90: fin(r.latency.p90), p99: fin(r.latency.p99), max: fin(r.latency.max) },
    errors: fin(r.errors), timeouts: fin(r.timeouts), non2xx: fin(r.non2xx),
  };
};

function tcpProbe(host: string, port: number, ms: number): Promise<"ok" | "refused" | "timeout"> {
  return new Promise((resolve) => {
    const s = connect({ host, port });
    const done = (r: "ok" | "refused" | "timeout") => { s.destroy(); resolve(r); };
    s.setTimeout(ms, () => done("timeout"));
    s.once("connect", () => done("ok"));
    s.once("error", () => done("refused"));
  });
}

/**
 * "Alive" = the port still accepts TCP connections. A server that is merely slow (a busy event loop answering
 * HTTP after several seconds) is not a crash. A refused connection is definitive; timeouts are retried 3 times.
 */
export const isAlive: IsAlive = async (url) => {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const port = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
  for (let i = 0; i < 3; i++) {
    const r = await tcpProbe(host, port, 3000);
    if (r !== "timeout") return r === "ok";
  }
  return false;
};

export const errorRate = (b: BenchResult) => Math.min(1, (b.errors + b.timeouts + b.non2xx) / Math.max(1, b.requests + b.errors));

export function breach(p: PhaseResult, t: Thresholds): string | null {
  if (p.errorRate > t.errorRate) return `error rate ${(p.errorRate * 100).toFixed(1)}% > ${(t.errorRate * 100).toFixed(1)}%`;
  if (p.latency.p99 > t.p99Ms) return `p99 ${p.latency.p99} ms > ${t.p99Ms} ms`;
  return null;
}

export function planPhases(profile: LoadProfile, o: { stepDuration: number; maxConnections: number; soakDuration: number }): PhasePlan[] {
  const cap = (c: number) => Math.min(c, o.maxConnections), d = o.stepDuration;
  if (profile === "ramp") {
    const cs = RAMP_CONNECTIONS.filter((c) => c <= o.maxConnections);
    return (cs.length ? cs : [o.maxConnections]).map((c) => ({ label: `ramp-${c}`, connections: c, durationSec: d, judged: true }));
  }
  if (profile === "spike") return [
    { label: "baseline", connections: cap(10), durationSec: d, judged: false },
    { label: "spike", connections: cap(100), durationSec: d, judged: true },
    { label: "recovery", connections: cap(10), durationSec: d, judged: false },
  ];
  const len = Math.max(d, o.soakDuration / 6), out: PhasePlan[] = [];
  for (let t = 0, i = 1; t < o.soakDuration - 1e-9; t += len, i++) {
    out.push({ label: `soak-${i}`, connections: cap(20), durationSec: r1(Math.min(len, o.soakDuration - t)), judged: true });
  }
  return out;
}

export interface ProfileRun {
  url: string; method: string; headers: Record<string, string>; plan: PhasePlan[];
  thresholds: Thresholds; stopOnBreach: boolean; recoveryTimeoutSec: number;
}
export type ProfileOutcome = Pick<LoadResult, "phases" | "breakingPoint" | "crashed" | "recovered"> & { crashedAt: PhasePlan | null; recoveredAfterSec: number | null };

/** Runs phases in order; health-checks after each one. Never leaves a rejected promise behind. */
export async function runPhases(o: ProfileRun, deps: { runBench: RunBench; isAlive: IsAlive; pollMs?: number }): Promise<ProfileOutcome> {
  const out: ProfileOutcome = { phases: [], breakingPoint: null, crashed: false, recovered: null, crashedAt: null, recoveredAfterSec: null };
  for (const ph of o.plan) {
    let bench: BenchResult | null = null, failure: unknown = null;
    try { bench = await deps.runBench({ url: o.url, method: o.method, headers: o.headers, connections: ph.connections, durationSec: ph.durationSec }); }
    catch (e) { failure = e; }
    const phase: PhaseResult | null = bench && { label: ph.label, connections: ph.connections, durationSec: ph.durationSec, ...bench, errorRate: Math.round(errorRate(bench) * 1e4) / 1e4 };
    if (phase) out.phases.push(phase);
    if (!(await deps.isAlive(o.url).catch(() => false))) {
      out.crashed = true; out.crashedAt = ph;
      out.breakingPoint ??= { connections: ph.connections, reason: `server crashed during ${ph.label}` };
      break;
    }
    if (failure) throw new WreckError(`load phase ${ph.label} failed: ${(failure as Error)?.message ?? String(failure)}`);
    const why = phase && ph.judged ? breach(phase, o.thresholds) : null;
    if (why) { out.breakingPoint ??= { connections: ph.connections, reason: why }; if (o.stopOnBreach) break; }
  }
  if (out.crashed) {
    const t0 = Date.now(), deadline = t0 + o.recoveryTimeoutSec * 1000, poll = deps.pollMs ?? 500;
    out.recovered = false;
    while (Date.now() < deadline) {
      if (await deps.isAlive(o.url).catch(() => false)) { out.recovered = true; out.recoveredAfterSec = r1((Date.now() - t0) / 1000); break; }
      await new Promise((r) => setTimeout(r, Math.min(poll, Math.max(0, deadline - Date.now()))));
    }
  }
  return out;
}
