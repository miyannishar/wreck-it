import { execFile } from "node:child_process";
import type { MemoryTrend } from "./types.js";

type Sample = MemoryTrend["samples"][number];

function execOut(cmd: string, args: string[], timeout = 3000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}

/** PID listening on the URL's port via `lsof` (darwin/linux). null when unavailable or ambiguous-empty. */
export async function findListeningPid(url: URL): Promise<number | null> {
  if (process.platform !== "darwin" && process.platform !== "linux") return null;
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  try {
    const pids = (await execOut("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"])).split(/\s+/).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    return pids[0] ?? null;
  } catch { return null; }
}

/** RSS of a process in MB via `ps -o rss=` (KB). null when the process is gone or ps fails. */
export async function sampleRssMb(pid: number): Promise<number | null> {
  try {
    const kb = Number((await execOut("ps", ["-o", "rss=", "-p", String(pid)])).trim());
    return Number.isFinite(kb) && kb > 0 ? kb / 1024 : null;
  } catch { return null; }
}

/** Least-squares slope in MB/min. */
export function slopeMbPerMin(samples: Sample[]): number {
  const n = samples.length;
  if (n < 2) return 0;
  const mx = samples.reduce((s, p) => s + p.tSec, 0) / n, my = samples.reduce((s, p) => s + p.rssMb, 0) / n;
  let num = 0, den = 0;
  for (const p of samples) { num += (p.tSec - mx) * (p.rssMb - my); den += (p.tSec - mx) ** 2; }
  return den === 0 ? 0 : (num / den) * 60;
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Leak = ≥ 60 s of samples AND (slope > 5 MB/min OR fitted growth > 20%). Short runs never flag (warm-up noise). */
export function memoryTrend(samples: Sample[]): MemoryTrend {
  const slope = slopeMbPerMin(samples);
  const span = samples.length ? samples[samples.length - 1]!.tSec - samples[0]!.tSec : 0;
  const mean = samples.reduce((s, p) => s + p.rssMb, 0) / Math.max(1, samples.length);
  const mt = samples.reduce((s, p) => s + p.tSec, 0) / Math.max(1, samples.length);
  const start = mean + (slope / 60) * ((samples[0]?.tSec ?? 0) - mt);
  const growth = start > 0 ? ((slope / 60) * span) / start : 0;
  return {
    samples: samples.map((s) => ({ tSec: round(s.tSec, 1), rssMb: round(s.rssMb) })),
    slopeMbPerMin: round(slope, 3),
    leakSuspected: span >= 60 && (slope > 5 || growth > 0.2),
  };
}

/** Samples RSS every `everyMs` until stopped. Never rejects. */
export function startSampler(pid: number, sample: (pid: number) => Promise<number | null> = sampleRssMb, everyMs = 1000) {
  const t0 = Date.now(), samples: Sample[] = [];
  const take = () => sample(pid).then((mb) => { if (mb !== null) samples.push({ tSec: (Date.now() - t0) / 1000, rssMb: mb }); }, () => {});
  let pending = take();
  const timer = setInterval(() => { pending = pending.then(take); }, everyMs);
  timer.unref();
  return {
    async stop(): Promise<Sample[]> { clearInterval(timer); await pending; await take(); return samples.sort((a, b) => a.tSec - b.tSec); },
  };
}
