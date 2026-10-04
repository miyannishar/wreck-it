import { readFile } from "node:fs/promises";
import { z } from "zod";
import { wreckPaths } from "./paths.js";
import { WreckError } from "./errors.js";
import { formatZodError } from "./schema.js";

export const ConfigSchema = z.strictObject({
  baseUrl: z.string().url().optional(),
  accounts: z.array(z.strictObject({ label: z.string().min(1), email: z.string().min(1), password: z.string().min(1) })).default([]),
  allowMutatingLoad: z.boolean().default(false),
  iOwnThis: z.boolean().default(false),
  exclude: z.array(z.string()).default([]),
  thresholds: z
    .strictObject({ p99Ms: z.number().positive().default(2000), errorRate: z.number().min(0).max(1).default(0.01) })
    .default({ p99Ms: 2000, errorRate: 0.01 }),
});
export type Config = z.output<typeof ConfigSchema>;

export async function loadConfig(root: string): Promise<Config> {
  const file = wreckPaths(root).config;
  let raw: string;
  try { raw = await readFile(file, "utf8"); } catch { return ConfigSchema.parse({}); }
  let json: unknown;
  try { json = JSON.parse(raw); }
  catch (e) { throw new WreckError(`${file} is not valid JSON: ${(e as Error).message}`); }
  const r = ConfigSchema.safeParse(json);
  if (!r.success) throw new WreckError(`${file} is invalid:\n${formatZodError(r.error)}`);
  return r.data;
}
