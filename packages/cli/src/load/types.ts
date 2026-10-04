import { z } from "zod";

export interface BenchResult {
  requests: number; rps: number;
  latency: { p50: number; p90: number; p99: number; max: number };
  errors: number; timeouts: number; non2xx: number;
}
export interface PhaseResult extends BenchResult { label: string; connections: number; durationSec: number; errorRate: number }
export type LoadProfile = "ramp" | "spike" | "soak";
export interface MemoryTrend { samples: { tSec: number; rssMb: number }[]; slopeMbPerMin: number; leakSuspected: boolean }
export interface LoadResult {
  url: string; method: string; profile: LoadProfile; startedAt: string;
  phases: PhaseResult[];
  breakingPoint: { connections: number; reason: string } | null;
  crashed: boolean; recovered: boolean | null;
  memory: MemoryTrend | null;
}

const num = z.number().finite();
export const LoadResultSchema = z.object({
  url: z.string(), method: z.string(), profile: z.enum(["ramp", "spike", "soak"]), startedAt: z.string(),
  phases: z.array(z.object({
    label: z.string(), connections: num, durationSec: num, requests: num, rps: num,
    latency: z.object({ p50: num, p90: num, p99: num, max: num }),
    errors: num, timeouts: num, non2xx: num, errorRate: num,
  })),
  breakingPoint: z.object({ connections: num, reason: z.string() }).nullable(),
  crashed: z.boolean(), recovered: z.boolean().nullable(),
  memory: z.object({
    samples: z.array(z.object({ tSec: num, rssMb: num })), slopeMbPerMin: num, leakSuspected: z.boolean(),
  }).nullable(),
});
