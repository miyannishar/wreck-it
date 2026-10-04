import { join } from "node:path";
import { mkdir } from "node:fs/promises";

export interface WreckPaths {
  root: string; dir: string; findings: string; shots: string; load: string;
  config: string; run: string; visits: string; discovery: string; personas: string;
  reportHtml: string; reportMd: string; testsDir: string; a11y: string; perf: string; fuzz: string;
}

export function wreckPaths(root: string): WreckPaths {
  const dir = join(root, ".wreck-it");
  return {
    root, dir,
    findings: join(dir, "findings"),
    shots: join(dir, "shots"),
    load: join(dir, "load"),
    config: join(dir, "config.json"),
    run: join(dir, "run.json"),
    visits: join(dir, "visits.jsonl"),
    discovery: join(dir, "discovery.json"),
    personas: join(dir, "personas.md"),
    reportHtml: join(dir, "report.html"),
    reportMd: join(dir, "report.md"),
    testsDir: join(root, "tests", "wreck-it"),
    a11y: join(dir, "a11y"),
    perf: join(dir, "perf"),
    fuzz: join(dir, "fuzz"),
  };
}

export async function ensureDirs(p: WreckPaths): Promise<void> {
  for (const d of [p.dir, p.findings, p.shots, p.load]) await mkdir(d, { recursive: true });
}
