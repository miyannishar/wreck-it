import { readFile, readdir, access } from "node:fs/promises";
import { basename, join } from "node:path";
import { listFindings } from "../findings.js";
import { readRun, listCreated, STAGES, type Created, type Stage, type StageStatus } from "../run.js";
import { computeScore, type ScoreResult } from "../score.js";
import { loadConfig } from "../config.js";
import { wreckPaths } from "../paths.js";
import type { Finding, Severity } from "../schema.js";
import { LoadResultSchema, type LoadResult } from "../load/types.js";

export interface Coverage {
  stages: Record<Stage, StageStatus | "not run">;
  personas: string[];
  visitedRoutes: string[];
  discoveredRoutes: string[];
  unvisitedRoutes: string[];
}
export interface ReportData {
  generatedAt: string; projectName: string; baseUrl?: string;
  score: ScoreResult;
  confirmed: Finding[];
  unconfirmed: Finding[];
  load: LoadResult[];
  coverage: Coverage;
  incomplete: Stage[];
  fixFirst: Finding | null;
  /** Test data the run created in the app (log of `wreck-it run created` and fuzz writes), for cleanup. */
  created: Created[];
  warnings: string[];
}

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
const REQUIRED_STAGES: Stage[] = ["normal", "explore", "chaos", "load"];
const idNum = (f: Finding) => Number(f.id.slice(3));

async function readJson(file: string): Promise<any | undefined> {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return undefined; }
}
async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

async function readLoadResults(dir: string, warnings: string[]): Promise<LoadResult[]> {
  const load: LoadResult[] = [];
  if (!(await exists(dir))) return load;
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".json")).sort()) {
    const parsed = LoadResultSchema.safeParse(await readJson(join(dir, name)));
    if (parsed.success) load.push(parsed.data as LoadResult);
    else warnings.push(`unreadable load result: ${name}`);
  }
  return load;
}

export async function buildReportData(root: string): Promise<ReportData> {
  const p = wreckPaths(root);
  const warnings: string[] = [];

  const { findings, errors } = await listFindings(root);
  for (const e of errors) warnings.push(`skipped corrupt finding: ${e.file}`);

  const bySeverity = (a: Finding, b: Finding) =>
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || idNum(a) - idNum(b);
  const confirmed = findings.filter((f) => f.reproduced).sort(bySeverity);
  const unconfirmed = findings.filter((f) => !f.reproduced).sort((a, b) => idNum(a) - idNum(b));

  for (const f of findings) {
    for (const shot of f.evidence.screenshots) {
      if (!(await exists(join(p.dir, shot)))) warnings.push(`missing screenshot for ${f.id}: ${shot}`);
    }
  }

  const load = await readLoadResults(p.load, warnings);

  const { run, visits } = await readRun(root);
  const stages = Object.fromEntries(STAGES.map((s) => [s, run?.stages?.[s] ?? "not run"])) as Coverage["stages"];
  const visitedRoutes = [...new Set(visits.map((v) => v.route))].sort();
  const personas = [...new Set(visits.map((v) => v.persona))];
  const discovery = await readJson(p.discovery);
  const discoveredRoutes: string[] = Array.isArray(discovery?.pages)
    ? [...new Set<string>(discovery.pages.map((x: any) => x?.path).filter((x: unknown): x is string => typeof x === "string"))]
    : [];
  const unvisitedRoutes = discoveredRoutes.filter((r) => !visitedRoutes.includes(r));

  let baseUrl: string | undefined;
  try { baseUrl = (await loadConfig(root)).baseUrl; } catch (e) { warnings.push(`unreadable config: ${(e as Error).message.split("\n")[0]}`); }
  baseUrl ??= typeof discovery?.baseUrl === "string" ? discovery.baseUrl : undefined;

  const pkg = await readJson(join(root, "package.json"));
  const projectName = typeof pkg?.name === "string" && pkg.name ? pkg.name : basename(root);

  const incomplete = REQUIRED_STAGES.filter((s) => stages[s] !== "done" && stages[s] !== "skipped");
  const fixFirst = confirmed.find((f) => f.severity === "critical") ?? confirmed.find((f) => f.severity === "high") ?? null;

  return {
    generatedAt: new Date().toISOString(), projectName, baseUrl,
    score: computeScore(findings), confirmed, unconfirmed, load,
    coverage: { stages, personas, visitedRoutes, discoveredRoutes, unvisitedRoutes },
    incomplete, fixFirst, created: await listCreated(root), warnings,
  };
}
