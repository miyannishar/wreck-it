import { readFile, appendFile, rm, mkdir } from "node:fs/promises";
import { wreckPaths, ensureDirs } from "./paths.js";
import { WreckError } from "./errors.js";
import { writeAtomic } from "./findings.js";

export const STAGES = ["preflight", "discover", "personas", "normal", "explore", "chaos", "load", "security", "trace", "report"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_STATUSES = ["running", "done", "skipped", "failed"] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];
/** `focus`: a focused run tests one feature only, so its score is not a readiness score for the whole app. */
export interface RunState { startedAt: string; stages: Partial<Record<Stage, StageStatus>>; focus?: string }

export async function initRun(root: string, opts: { fresh: boolean; focus?: string }): Promise<RunState> {
  const p = wreckPaths(root);
  if (opts.fresh) for (const t of [p.findings, p.shots, p.load, p.visits, p.reportHtml, p.reportMd]) await rm(t, { recursive: true, force: true });
  await ensureDirs(p);
  const state: RunState = { startedAt: new Date().toISOString(), stages: {}, ...(opts.focus ? { focus: opts.focus } : {}) };
  await writeAtomic(p.run, JSON.stringify(state, null, 2));
  return state;
}

async function readState(root: string): Promise<RunState | null> {
  try {
    const v: unknown = JSON.parse(await readFile(wreckPaths(root).run, "utf8"));
    if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
    const st = (v as { stages?: unknown }).stages;
    if (typeof st !== "object" || st === null || Array.isArray(st)) return null;
    return v as RunState;
  } catch { return null; }
}

export async function setStage(root: string, stage: Stage, status: StageStatus): Promise<RunState> {
  if (!STAGES.includes(stage)) throw new WreckError(`unknown stage "${stage}" (one of ${STAGES.join(", ")})`, 2);
  if (!STAGE_STATUSES.includes(status)) throw new WreckError(`unknown status "${status}" (one of ${STAGE_STATUSES.join(", ")})`, 2);
  const state = (await readState(root)) ?? (await initRun(root, { fresh: false }));
  state.stages[stage] = status;
  await writeAtomic(wreckPaths(root).run, JSON.stringify(state, null, 2));
  return state;
}

export async function recordVisit(root: string, route: string, persona: string): Promise<void> {
  const p = wreckPaths(root);
  await mkdir(p.dir, { recursive: true });
  await appendFile(p.visits, JSON.stringify({ route, persona, at: new Date().toISOString() }) + "\n");
}

export async function readRun(root: string): Promise<{ run: RunState | null; visits: { route: string; persona: string }[] }> {
  const run = await readState(root);
  let raw = "";
  try { raw = await readFile(wreckPaths(root).visits, "utf8"); } catch { /* none yet */ }
  const visits: { route: string; persona: string }[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (typeof v.route === "string" && typeof v.persona === "string") visits.push({ route: v.route, persona: v.persona });
    } catch { /* skip malformed */ }
  }
  return { run, visits };
}

/** Test data a run created (accounts, orders, posts…), so the report can list it for cleanup. */
export interface Created { at: string; by: string; what: string; count?: number }
const createdFile = (root: string) => `${wreckPaths(root).dir}/created.jsonl`;

export async function recordCreated(root: string, c: Omit<Created, "at">): Promise<void> {
  await ensureDirs(wreckPaths(root));
  await appendFile(createdFile(root), JSON.stringify({ at: new Date().toISOString(), ...c }) + "\n");
}

export async function listCreated(root: string): Promise<Created[]> {
  let raw = "";
  try { raw = await readFile(createdFile(root), "utf8"); } catch { return []; }
  return raw.split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as Created]; } catch { return []; } });
}
