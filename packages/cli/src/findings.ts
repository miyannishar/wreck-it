import { readdir, readFile, writeFile, copyFile, mkdir, unlink, rename } from "node:fs/promises";
import { ZodError } from "zod";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve, relative, extname, sep, isAbsolute } from "node:path";
import { FindingInputSchema, FindingSchema, formatZodError, type Finding } from "./schema.js";
import { wreckPaths, ensureDirs } from "./paths.js";
import { WreckError } from "./errors.js";

const idFile = /^WR-(\d{3,})\.json$/;
const oneLine = (e: unknown): string =>
  e instanceof ZodError ? formatZodError(e).split("\n").join("; ") : (e as Error).message.split("\n")[0]!;

export async function writeAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try { await writeFile(tmp, data); await rename(tmp, file); }
  catch (e) { await unlink(tmp).catch(() => {}); throw e; }
}

const toPosix = (p: string) => p.split(sep).join("/");

/** A trace stays where the browser wrote it (a live trace is a file plus a resources/ folder); store it relative to the project. */
function tracePath(root: string, trace: string, warnings: string[]): string {
  const abs = resolve(root, trace);
  if (!existsSync(abs)) warnings.push(`trace not found: ${trace}`);
  const rel = relative(root, abs);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? toPosix(rel) : abs;
}

async function nextNumber(dir: string): Promise<number> {
  const names = existsSync(dir) ? await readdir(dir) : [];
  let max = 0;
  for (const n of names) { const m = idFile.exec(n); if (m) max = Math.max(max, Number(m[1])); }
  return max + 1;
}

async function reserveId(dir: string): Promise<string> {
  let n = await nextNumber(dir);
  for (let i = 0; i < 10_000; i++, n++) {
    const id = `WR-${String(n).padStart(3, "0")}`;
    try { await writeFile(join(dir, `${id}.json`), "{}", { flag: "wx" }); return id; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  }
  throw new WreckError("could not allocate a finding id");
}

export async function addFinding(root: string, input: unknown): Promise<{ finding: Finding; warnings: string[] }> {
  const parsed = FindingInputSchema.safeParse(input);
  if (!parsed.success) throw new WreckError(`invalid finding:\n${formatZodError(parsed.error)}`, 2);
  const p = wreckPaths(root);
  await ensureDirs(p);
  const id = await reserveId(p.findings);
  try {
    const warnings: string[] = [];
    const shots: string[] = [];
    for (const [i, s] of parsed.data.evidence.screenshots.entries()) {
      const abs = resolve(root, s);
      if (!existsSync(abs)) { warnings.push(`screenshot not found: ${s}`); shots.push(toPosix(relative(p.dir, abs))); continue; }
      const rel = relative(p.dir, abs);
      if (rel && !rel.startsWith("..") && !isAbsolute(rel)) { shots.push(toPosix(rel)); continue; }
      const name = `${id}-${i + 1}${extname(abs) || ".png"}`;
      await mkdir(p.shots, { recursive: true });
      await copyFile(abs, join(p.shots, name));
      shots.push(`shots/${name}`);
    }
    const trace = parsed.data.evidence.trace ? tracePath(root, parsed.data.evidence.trace, warnings) : undefined;
    const finding = FindingSchema.parse({
      ...parsed.data,
      evidence: { ...parsed.data.evidence, screenshots: shots, ...(trace ? { trace } : {}) },
      id,
      createdAt: new Date().toISOString(),
    });
    await writeAtomic(join(p.findings, `${id}.json`), JSON.stringify(finding, null, 2));
    return { finding, warnings };
  } catch (e) {
    await unlink(join(p.findings, `${id}.json`)).catch(() => {});
    throw e;
  }
}

export async function updateFinding(root: string, id: string, patch: unknown): Promise<Finding> {
  if (!/^WR-\d{3,}$/.test(id)) throw new WreckError(`invalid finding id: ${id}`, 2);
  const file = join(wreckPaths(root).findings, `${id}.json`);
  if (!existsSync(file)) throw new WreckError(`finding ${id} not found`, 2);
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) throw new WreckError("patch must be a JSON object", 2);
  let current: Finding;
  try { current = FindingSchema.parse(JSON.parse(await readFile(file, "utf8"))); }
  catch (e) { throw new WreckError(`finding ${id} is corrupt or incomplete: ${oneLine(e)}`, 2); }
  const pt = patch as Record<string, unknown>;
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const merged: Record<string, unknown> = { ...current, ...pt };
  if (isObj(pt.evidence)) {
    merged.evidence = { ...current.evidence, ...pt.evidence };
    if (typeof pt.evidence.trace === "string" && pt.evidence.trace) (merged.evidence as Record<string, unknown>).trace = tracePath(root, pt.evidence.trace, []);
  }
  const r = FindingSchema.safeParse({ ...merged, id: current.id, createdAt: current.createdAt });
  if (!r.success) throw new WreckError(`invalid update for ${id}:\n${formatZodError(r.error)}`, 2);
  await writeAtomic(file, JSON.stringify(r.data, null, 2));
  return r.data;
}

export async function listFindings(root: string): Promise<{ findings: Finding[]; errors: { file: string; message: string }[] }> {
  const dir = wreckPaths(root).findings;
  if (!existsSync(dir)) return { findings: [], errors: [] };
  const findings: Finding[] = [];
  const errors: { file: string; message: string }[] = [];
  for (const name of (await readdir(dir)).filter((n) => idFile.test(n))) {
    const file = join(dir, name);
    try {
      const raw = await readFile(file, "utf8");
      if (raw.trim() === "{}") continue; // reserved by a concurrent add, not yet written
      findings.push(FindingSchema.parse(JSON.parse(raw)));
    } catch (e) { errors.push({ file, message: oneLine(e) }); }
  }
  findings.sort((a, b) => Number(a.id.slice(3)) - Number(b.id.slice(3)));
  return { findings, errors };
}
