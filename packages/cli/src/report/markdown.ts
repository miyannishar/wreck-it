import { CATEGORIES, type Finding, type Severity } from "../schema.js";
import type { LoadResult } from "../load/types.js";
import { STAGES } from "../run.js";
import { describeStep } from "./describe.js";
import type { ReportData } from "./data.js";

const one = (s: string): string => s.replace(/\s*[\r\n]+\s*/g, " ");
const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

function renderFinding(f: Finding): string[] {
  const out = [
    `#### ${f.id} · ${one(f.title)}`,
    `- **Category:** ${f.category} · **Persona:** ${f.persona} · **Route:** \`${f.route}\``,
    `- **Expected:** ${one(f.expected)}`,
    `- **Actual:** ${one(f.actual)}`,
  ];
  const s = f.source;
  if (!s) out.push("- **Source:** _not traced_");
  else if (s.confidence === "low") out.push(`- **Likely in:** ${s.candidates.map((c) => `\`${c}\``).join(", ")} — ${one(s.why)}`);
  else out.push(`- **Source:** \`${s.file}:${s.line}\` — ${one(s.why)} (confidence: ${s.confidence})`);
  out.push("- **Steps to reproduce:**");
  f.steps.forEach((st, i) => out.push(`  ${i + 1}. ${one(describeStep(st))}`));
  if (f.evidence.screenshots.length) {
    out.push(`- **Screenshots:** ${f.evidence.screenshots.map((p, i) => `![${f.id}-${i + 1}](<${p}>)`).join(" ")}`);
  }
  if (f.evidence.trace) out.push(`- **Trace:** \`npx playwright show-trace ${f.evidence.trace}\``);
  if (f.category !== "performance") out.push(`- **Regression test:** \`tests/wreck-it/${f.id}.spec.ts\``);
  return out;
}

function renderLoad(r: LoadResult): string[] {
  const out = [
    `### ${r.method.toUpperCase()} ${r.url} (${r.profile})`,
    "| Connections | RPS | p50 | p90 | p99 | Error rate |",
    "|---:|---:|---:|---:|---:|---:|",
  ];
  for (const p of r.phases) {
    out.push(`| ${p.connections} | ${Math.round(p.rps)} | ${p.latency.p50} ms | ${p.latency.p90} ms | ${p.latency.p99} ms | ${(p.errorRate * 100).toFixed(1)}% |`);
  }
  out.push("");
  if (r.breakingPoint) out.push(`Breaking point: ${r.breakingPoint.connections} connections — ${r.breakingPoint.reason}`);
  else out.push(`No breaking point found up to ${Math.max(0, ...r.phases.map((p) => p.connections))} connections`);
  if (r.crashed) out.push("", `Crashed under load; recovered: ${r.recovered ? "yes" : "no"}`);
  if (r.memory) out.push("", `Memory: ${r.memory.slopeMbPerMin.toFixed(2)} MB/min (${r.memory.leakSuspected ? "leak suspected" : "stable"})`);
  return out;
}

export function renderMarkdown(d: ReportData): string {
  const L: string[] = [];
  L.push(`# wreck-it report — ${d.projectName}`, "");
  L.push(`**Readiness: ${d.score.score}/100 — ${d.score.band}**`);
  if (d.fixFirst) L.push(`> Fix this first: ${d.fixFirst.id} ${one(d.fixFirst.title)}`);
  L.push("");
  if (d.incomplete.length) L.push(`> ⚠ Run incomplete: ${d.incomplete.join(", ")} did not finish`, "");

  L.push("## Scores by category", "| Category | Findings | Subscore |", "|---|---:|---:|");
  for (const c of CATEGORIES) L.push(`| ${c} | ${d.score.categories[c].count} | ${d.score.categories[c].subscore} |`);
  L.push("");

  L.push("## Findings");
  if (!d.confirmed.length) L.push("_No confirmed findings._", "");
  for (const sev of SEVERITY_ORDER) {
    const group = d.confirmed.filter((f) => f.severity === sev);
    if (!group.length) continue;
    L.push(`### ${sev.toUpperCase()}`);
    for (const f of group) L.push(...renderFinding(f), "");
  }

  if (d.load.length) {
    L.push("## Load testing");
    for (const r of d.load) L.push(...renderLoad(r), "");
  }

  const c = d.coverage;
  L.push("## Coverage");
  L.push(`- Stages: ${STAGES.map((s) => `${s}: ${c.stages[s]}`).join(", ")}`);
  L.push(`- Personas: ${c.personas.length ? c.personas.join(", ") : "none"}`);
  const unvisited = c.unvisitedRoutes.length ? `; not visited: ${c.unvisitedRoutes.map((r) => `\`${r}\``).join(", ")}` : "";
  L.push(`- Routes visited: ${c.visitedRoutes.length}/${c.discoveredRoutes.length}${unvisited}`);
  L.push("");

  if (d.created.length) {
    L.push("## Test data created", "", "wreck-it created these in the app (all runs so far). If it ran against a shared or production database, delete them:");
    for (const c of d.created) L.push(`- ${one(c.what)} _(by ${one(c.by)})_`);
    L.push("");
  }
  if (d.unconfirmed.length) {
    L.push("## Unconfirmed / flaky");
    for (const f of d.unconfirmed) L.push(`- ${f.id} · ${one(f.title)}`);
    L.push("");
  }
  if (d.warnings.length) {
    L.push("## Warnings");
    for (const w of d.warnings) L.push(`- ${one(w)}`);
    L.push("");
  }
  return L.join("\n").trimEnd() + "\n";
}
