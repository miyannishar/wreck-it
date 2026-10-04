import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { createServer, type Server, type RequestListener } from "node:http";
import type { Socket } from "node:net";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { CLI, runCli, tmpRoot } from "./helpers.js";
import { runLoadTest, loadSlug, parseHeaders, remoteDbHost, type LoadDeps } from "../src/load/index.js";
import { planPhases, errorRate, breach, isAlive, type RunBench } from "../src/load/run.js";
import { memoryTrend, slopeMbPerMin } from "../src/load/memory.js";
import { LoadResultSchema, type BenchResult } from "../src/load/types.js";
import { listFindings } from "../src/findings.js";
import { buildReportData } from "../src/report/data.js";

interface Srv { server: Server; port: number; url: string; kill: () => Promise<void> }
const open: Srv[] = [];

function listen(handler: RequestListener, port = 0): Promise<Srv> {
  const server = createServer(handler), sockets = new Set<Socket>();
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const p = (server.address() as { port: number }).port;
      const srv: Srv = {
        server, port: p, url: `http://127.0.0.1:${p}/api/items`,
        kill: () => new Promise<void>((r) => { server.close(() => r()); for (const s of sockets) s.destroy(); server.closeAllConnections?.(); }),
      };
      open.push(srv); resolve(srv);
    });
  });
}
afterEach(async () => { await Promise.all(open.splice(0).map((s) => (s.server.listening ? s.kill() : undefined))); });

const ok: RequestListener = (_q, res) => { res.end("ok"); };
const bench = (over: Partial<BenchResult> = {}): BenchResult =>
  ({ requests: 1000, rps: 1000, latency: { p50: 2, p90: 4, p99: 8, max: 20 }, errors: 0, timeouts: 0, non2xx: 0, ...over });
const fast = (runBench: RunBench, extra: Partial<LoadDeps> = {}): Partial<LoadDeps> =>
  ({ runBench, isAlive: async () => true, findPid: async () => null, warn: () => {}, pollMs: 20, ...extra });

describe("load: pure helpers", () => {
  it("plans ramp/spike/soak phases", () => {
    expect(planPhases("ramp", { stepDuration: 10, maxConnections: 500, soakDuration: 180 }).map((p) => p.connections)).toEqual([10, 25, 50, 100, 200, 350, 500]);
    expect(planPhases("ramp", { stepDuration: 1, maxConnections: 60, soakDuration: 180 }).map((p) => p.connections)).toEqual([10, 25, 50]);
    expect(planPhases("spike", { stepDuration: 2, maxConnections: 500, soakDuration: 180 }).map((p) => [p.label, p.connections, p.judged]))
      .toEqual([["baseline", 10, false], ["spike", 100, true], ["recovery", 10, false]]);
    const soak = planPhases("soak", { stepDuration: 10, maxConnections: 500, soakDuration: 180 });
    expect(soak.map((p) => p.durationSec)).toEqual([30, 30, 30, 30, 30, 30]);
    expect(soak.every((p) => p.connections === 20)).toBe(true);
    expect(planPhases("soak", { stepDuration: 1, maxConnections: 500, soakDuration: 2.5 }).map((p) => p.durationSec)).toEqual([1, 1, 0.5]);
  });
  it("computes error rate and threshold breaches", () => {
    expect(errorRate(bench({ requests: 90, errors: 10, non2xx: 5, timeouts: 5 }))).toBeCloseTo(0.2);
    expect(errorRate(bench({ requests: 0, errors: 0 }))).toBe(0);
    const t = { p99Ms: 100, errorRate: 0.01 };
    const ph = (b: BenchResult) => ({ ...b, label: "x", connections: 1, durationSec: 1, errorRate: errorRate(b) });
    expect(breach(ph(bench()), t)).toBeNull();
    expect(breach(ph(bench({ non2xx: 50 })), t)).toMatch(/error rate 5\.0% > 1\.0%/);
    expect(breach(ph(bench({ latency: { p50: 1, p90: 1, p99: 150, max: 200 } })), t)).toMatch(/p99 150 ms > 100 ms/);
  });
  it("fits memory slope and flags leaks only over >= 60 s", () => {
    const line = (mbPerMin: number, span: number, base = 100) =>
      Array.from({ length: span + 1 }, (_, t) => ({ tSec: t, rssMb: base + (mbPerMin / 60) * t + (t % 2 ? 0.1 : -0.1) }));
    expect(slopeMbPerMin(line(10, 120))).toBeCloseTo(10, 1);
    expect(slopeMbPerMin([{ tSec: 0, rssMb: 5 }])).toBe(0);
    expect(memoryTrend(line(10, 120)).leakSuspected).toBe(true);
    expect(memoryTrend(line(0, 120)).leakSuspected).toBe(false);
    expect(memoryTrend(line(30, 30)).leakSuspected).toBe(false); // too short: warm-up noise
    expect(memoryTrend(line(4, 120, 10)).leakSuspected).toBe(true); // slope < 5 but +80% growth
    expect(memoryTrend(line(4, 120, 500)).leakSuspected).toBe(false);
  });
  it("slugs, headers, db hosts", () => {
    expect(loadSlug("GET", "/api/items/:id")).toBe("get-api-items-id");
    expect(loadSlug("GET", "/")).toBe("get-root");
    expect(parseHeaders(["Authorization: Bearer a:b", "x-a:1"])).toEqual({ Authorization: "Bearer a:b", "x-a": "1" });
    expect(() => parseHeaders(["nope"])).toThrow(/invalid --header/);
    expect(remoteDbHost("postgres://u:p@db.prod.example.com:5432/app")).toBe("db.prod.example.com");
    for (const u of ["postgres://u:p@localhost:5432/a", "postgres://127.0.0.1/a", "postgres://db:5432/a", "file:./dev.db", "nonsense"]) expect(remoteDbHost(u)).toBeNull();
  });
});

describe("load: runLoadTest with injected bench", () => {
  it("spike: breaking point only when the spike phase breaches; writes a valid result the report reads", async () => {
    const root = await tmpRoot(), seen: Record<string, string>[] = [];
    const runBench: RunBench = async (o) => { seen.push(o.headers); return o.connections === 100 ? bench({ non2xx: 300 }) : bench(); };
    const out = await runLoadTest(root, { url: "http://localhost:3999/api/items", profile: "spike", stepDuration: 1, headers: { "x-k": "v" } }, fast(runBench));
    expect(out.result.phases.map((p) => p.label)).toEqual(["baseline", "spike", "recovery"]);
    expect(out.result.breakingPoint).toEqual({ connections: 100, reason: "error rate 30.0% > 1.0%" });
    expect(out.result.crashed).toBe(false);
    expect(out.result.memory).toBeNull();
    expect(seen.every((h) => h["x-k"] === "v")).toBe(true);
    expect(out.file).toBe(join(root, ".wreck-it", "load", "get-api-items-spike.json"));
    expect(LoadResultSchema.safeParse(JSON.parse(await readFile(out.file, "utf8"))).success).toBe(true);
    const d = await buildReportData(root);
    expect(d.load).toHaveLength(1);
    expect(d.load[0]!.breakingPoint?.connections).toBe(100);
  });
  it("soak: splits duration and samples memory from the pid", async () => {
    const root = await tmpRoot(); let rss = 100;
    const out = await runLoadTest(root, { url: "http://127.0.0.1:3999/x", profile: "soak", stepDuration: 0.05, soakDuration: 0.3, pid: 4242 },
      fast(async (o) => { await new Promise((r) => setTimeout(r, o.durationSec * 1000)); return bench(); }, { sampleRss: async () => (rss += 1), sampleEveryMs: 20 }));
    expect(out.result.phases).toHaveLength(6);
    expect(out.result.phases.every((p) => p.connections === 20)).toBe(true);
    expect(out.result.memory!.samples.length).toBeGreaterThan(3);
    expect(out.result.memory!.slopeMbPerMin).toBeGreaterThan(0);
    expect(out.result.memory!.leakSuspected).toBe(false);
  });
  it("ramp stops at the first breach (p99)", async () => {
    const root = await tmpRoot();
    const out = await runLoadTest(root, { url: "http://localhost:3999/", profile: "ramp", stepDuration: 1 },
      fast(async (o) => bench({ latency: { p50: 1, p90: 1, p99: o.connections * 30, max: 1 } })));
    expect(out.result.phases.map((p) => p.connections)).toEqual([10, 25, 50, 100]);
    expect(out.result.breakingPoint).toEqual({ connections: 100, reason: "p99 3000 ms > 2000 ms" });
    expect(out.file.endsWith("get-root-ramp.json")).toBe(true);
  });
  it("bench that throws while the server dies → crashed, finding, no rejection", async () => {
    const root = await tmpRoot(); let alive = true;
    const out = await runLoadTest(root, { url: "http://localhost:3999/api/x", profile: "ramp", stepDuration: 1, recoveryTimeout: 0.2 },
      fast(async (o) => { if (o.connections === 25) { alive = false; throw new Error("boom"); } return bench(); }, { isAlive: async () => alive }));
    expect(out.result.crashed).toBe(true);
    expect(out.result.recovered).toBe(false);
    expect(out.result.phases).toHaveLength(1);
    expect(out.result.breakingPoint?.connections).toBe(25);
    expect(out.findingId).toBe("WR-001");
  });
  it("safety: target, method, reachability, remote DB warning", async () => {
    const root = await tmpRoot(), f = fast(async () => bench());
    await expect(runLoadTest(root, { url: "https://example.com/", profile: "ramp" }, f)).rejects.toMatchObject({ exitCode: 3 });
    await expect(runLoadTest(root, { url: "http://localhost:1/", profile: "ramp", method: "post" }, f)).rejects.toMatchObject({ exitCode: 2 });
    await expect(runLoadTest(root, { url: "http://localhost:1/", profile: "ramp" }, { ...f, isAlive: async () => false })).rejects.toMatchObject({ exitCode: 4 });
    await mkdir(join(root, ".wreck-it"), { recursive: true });
    await writeFile(join(root, ".wreck-it", "config.json"), JSON.stringify({ allowMutatingLoad: true }));
    await writeFile(join(root, ".wreck-it", "discovery.json"), JSON.stringify({ database: { kind: "postgres", remote: true } }));
    await writeFile(join(root, ".env.local"), 'DATABASE_URL="postgres://u:secret@db.prod.example.com:5432/app"\n');
    await writeFile(join(root, ".env.example"), "DATABASE_URL=postgres://u:p@other.example.com/app\n");
    const warn = vi.fn();
    const out = await runLoadTest(root, { url: "http://localhost:3999/api/orders", profile: "spike", method: "POST", stepDuration: 1 }, { ...f, warn });
    expect(out.result.method).toBe("POST");
    const msgs = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(msgs).toMatch(/remote postgres database/);
    expect(msgs).toMatch(/\.env\.local points at non-local host db\.prod\.example\.com/);
    expect(msgs).not.toMatch(/secret|other\.example/);
  });
});

describe("load: real autocannon against local servers", () => {
  it("ramp finds the breaking point of a server that 503s above 40 in-flight requests", async () => {
    let inflight = 0;
    const srv = await listen((_q, res) => {
      if (++inflight > 40) { inflight--; res.statusCode = 503; res.end("busy"); return; }
      setTimeout(() => { inflight--; res.end("ok"); }, 5);
    });
    const root = await tmpRoot();
    const out = await runLoadTest(root, { url: srv.url, profile: "ramp", stepDuration: 1 }, { warn: () => {} });
    expect(out.result.phases.map((p) => p.connections)).toEqual([10, 25, 50]);
    expect(out.result.phases[0]!.requests).toBeGreaterThan(100);
    expect(out.result.phases[1]!.errorRate).toBe(0);
    expect(out.result.breakingPoint?.connections).toBe(50);
    expect(out.result.breakingPoint?.reason).toMatch(/^error rate/);
    expect(out.result.crashed).toBe(false);
    expect(LoadResultSchema.safeParse(out.result).success).toBe(true);
  }, 20_000);

  it("server dying mid-run → crashed, critical finding, resolves without unhandled rejection", async () => {
    const spy = vi.fn();
    process.on("unhandledRejection", spy);
    try {
      let armed = false;
      const srv = await listen((_q, res) => {
        if (!armed) { armed = true; setTimeout(() => void srv.kill(), 300); }
        res.end("ok");
      });
      const root = await tmpRoot();
      const out = await runLoadTest(root, { url: srv.url, profile: "ramp", stepDuration: 1, recoveryTimeout: 1 }, { warn: () => {}, findPid: async () => null });
      expect(out.result.crashed).toBe(true);
      expect(out.result.recovered).toBe(false);
      expect(out.result.phases).toHaveLength(1);
      const { findings } = await listFindings(root);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        category: "performance", severity: "critical", persona: "load", route: "/api/items", reproduced: true,
        title: "Server crashed under load at 10 connections", steps: [{ action: "http", method: "GET", url: srv.url }],
      });
      expect(existsSync(out.file)).toBe(true);
      await new Promise((r) => setTimeout(r, 50));
      expect(spy).not.toHaveBeenCalled();
    } finally { process.off("unhandledRejection", spy); }
  }, 20_000);

  it("server restarting on the same port after a crash → recovered", async () => {
    let armed = false;
    const srv = await listen((_q, res) => {
      if (!armed) {
        armed = true;
        setTimeout(() => void srv.kill().then(() => setTimeout(() => void listen(ok, srv.port), 1500)), 200);
      }
      res.end("ok");
    });
    const root = await tmpRoot();
    const out = await runLoadTest(root, { url: srv.url, profile: "spike", stepDuration: 1, recoveryTimeout: 8 }, { warn: () => {}, findPid: async () => null });
    expect(out.result.crashed).toBe(true);
    expect(out.result.recovered).toBe(true);
    expect(out.recoveredAfterSec).toBeLessThan(8);
    const { findings } = await listFindings(root);
    expect(findings[0]!.actual).toMatch(/came back after/);
  }, 20_000);
});

describe("load: CLI", () => {
  beforeAll(async () => {
    if (existsSync(CLI)) return;
    await new Promise<void>((r) => execFile("npx", ["tsup"], { cwd: join(CLI, "..", "..") }, () => r()));
  }, 60_000);

  it("refuses public targets (exit 3), mutating methods (exit 2), unreachable ports (exit 4)", async () => {
    const root = await tmpRoot();
    const pub = await runCli(["load", "https://example.com/", "--root", root]);
    expect(pub.code).toBe(3);
    expect(pub.stderr).toMatch(/not localhost/);
    const post = await runCli(["load", "http://localhost:3999/api/x", "--method", "POST", "--root", root]);
    expect(post.code).toBe(2);
    expect(post.stderr).toMatch(/allowMutatingLoad/);
    const dead = await listen(ok); const port = dead.port; await dead.kill();
    const down = await runCli(["load", `http://127.0.0.1:${port}/`, "--root", root]);
    expect(down.code).toBe(4);
    expect(down.stderr).toMatch(/not reachable/);
  });

  it("runs a short ramp and prints JSON / summary", async () => {
    const srv = await listen(ok);
    const root = await tmpRoot();
    const r = await runCli(["load", srv.url, "--step-duration", "1", "--max-connections", "10", "--header", "x-test: 1", "--json", "--root", root]);
    expect(r.code).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(LoadResultSchema.safeParse(json).success).toBe(true);
    expect(json.phases).toHaveLength(1);
    expect(existsSync(join(root, ".wreck-it", "load", "get-api-items-ramp.json"))).toBe(true);
    const h = await runCli(["load", srv.url, "--step-duration", "1", "--max-connections", "10", "--root", root]);
    expect(h.code).toBe(0);
    expect(h.stdout).toMatch(/ramp-10/);
    expect(h.stdout).toMatch(/No breaking point found up to 10 connections/);
  }, 20_000);
});

describe("load: isAlive", () => {
  it("a slow server that never answers HTTP is alive; a closed port is dead", async () => {
    const hang = createServer(() => { /* never respond */ });
    await new Promise<void>((r) => hang.listen(0, "127.0.0.1", r));
    const port = (hang.address() as { port: number }).port;
    expect(await isAlive(`http://127.0.0.1:${port}/slow`)).toBe(true);
    hang.closeAllConnections(); await new Promise<void>((r) => hang.close(() => r()));
    expect(await isAlive(`http://127.0.0.1:${port}/slow`)).toBe(false);
  });
});
