import { CATEGORIES, type Finding, type Severity } from "../schema.js";
import type { LoadResult } from "../load/types.js";
import { STAGES } from "../run.js";
import type { Band } from "../score.js";
import { describeStep } from "./describe.js";
import { latencyChart } from "./charts.js";
import { escapeHtml as esc } from "./escape.js";
import type { ReportData } from "./data.js";

export type ReadShot = (rel: string) => Buffer | null;

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];
const BAND_CLASS: Record<Band, string> = { "Not ready": "band-bad", Risky: "band-risky", "Almost there": "band-almost", "Ship it": "band-ship" };
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** Escapes, then turns `x` spans (from describeStep) into <code>. Safe because input is already escaped. */
const rich = (s: string): string => esc(s).replace(/`([^`]*)`/g, "<code>$1</code>");
const li = (items: string[]): string => items.map((i) => `<li>${i}</li>`).join("");
const bandClass = (b: Band): string => BAND_CLASS[b] ?? "band-bad";

export function header(d: ReportData): string {
  const o = [`<header class="card hero ${bandClass(d.score.band)}">`,
    `<div class="name">wreck-it report · ${esc(d.projectName)}${d.baseUrl ? ` · ${esc(d.baseUrl)}` : ""}</div>`,
    `<div class="score">${esc(String(d.score.score))}<small>/100</small></div>`,
    `<span class="chip">${esc(d.score.band)}</span></header>`];
  if (d.fixFirst) o.push(`<div class="card fixfirst"><b>Fix this first</b><span class="id">${esc(d.fixFirst.id)}</span> ${esc(d.fixFirst.title)}</div>`);
  if (d.incomplete.length) o.push(`<div class="banner" role="status">Run incomplete: ${esc(d.incomplete.join(", "))} did not finish. The score may be understated or overstated.</div>`);
  return o.join("");
}

export function categories(d: ReportData): string {
  const rows = CATEGORIES.map((c) => {
    const s = d.score.categories[c];
    const band = s.subscore >= 90 ? "band-ship" : s.subscore >= 75 ? "band-almost" : s.subscore >= 50 ? "band-risky" : "band-bad";
    return `<div class="cat ${band}"><span>${esc(c)}</span><div class="bar" role="img" aria-label="${esc(`${c} subscore ${s.subscore} of 100`)}"><i style="width:${Math.max(0, Math.min(100, Math.round(s.subscore)))}%"></i></div><span class="n">${esc(String(s.subscore))}<span class="ct"> · ${esc(String(s.count))} found</span></span></div>`;
  });
  return `<h2>Scores by category</h2><div class="card cats">${rows.join("")}</div>`;
}

function screenshot(f: Finding, rel: string, i: number, readShot: ReadShot): string {
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  const mime = MIME[ext];
  let buf: Buffer | null = null;
  try { buf = mime ? readShot(rel) : null; } catch { buf = null; }
  if (!mime || !buf) return `<em>missing screenshot</em> <code>${esc(rel)}</code>`;
  return `<img alt="${esc(`${f.id} screenshot ${i + 1}`)}" src="data:${mime};base64,${buf.toString("base64")}">`;
}

function source(f: Finding): string {
  const s = f.source;
  if (!s) return `<h4>Source</h4><p class="muted">Not traced.</p>`;
  const where = s.confidence === "low"
    ? `Likely in ${s.candidates.map((c) => `<code>${esc(c)}</code>`).join(", ")}`
    : `<code>${esc(`${s.file}:${s.line}`)}</code>`;
  return `<h4>Source</h4><p>${where}</p>${s.snippet ? `<pre>${esc(s.snippet)}</pre>` : ""}<p>${esc(s.why)} <span class="muted">(confidence: ${esc(s.confidence)})</span></p>`;
}

export function finding(f: Finding, readShot: ReadShot): string {
  const sev = esc(f.severity);
  const o = [`<details class="card finding sev-${sev}"${f.severity === "critical" || f.severity === "high" ? " open" : ""}>`,
    `<summary><span class="tag">${sev}</span><span class="id">${esc(f.id)}</span><span class="title">${esc(f.title)}</span></summary><div class="body">`,
    `<p class="muted">${esc(f.category)} · persona ${esc(f.persona)} · route <code>${esc(f.route)}</code></p>`,
    `<h4>Steps to reproduce</h4><ol>${li(f.steps.map((s) => rich(describeStep(s))))}</ol>`,
    `<h4>Expected</h4><p>${esc(f.expected)}</p><h4>Actual</h4><p>${esc(f.actual)}</p>`, source(f)];
  if (f.evidence.screenshots.length) o.push(`<h4>Screenshots</h4><div class="shots">${f.evidence.screenshots.map((r, i) => screenshot(f, r, i, readShot)).join("")}</div>`);
  if (f.evidence.console.length) o.push(`<h4>Console</h4><pre>${esc(f.evidence.console.join("\n"))}</pre>`);
  if (f.evidence.network.length) o.push(`<h4>Network</h4><pre>${esc(f.evidence.network.map((n) => `${n.method} ${n.url} → ${n.status}`).join("\n"))}</pre>`);
  if (f.category !== "performance") o.push(`<h4>Regression test</h4><p><code>${esc(`tests/wreck-it/${f.id}.spec.ts`)}</code></p>`);
  o.push("</div></details>");
  return o.join("");
}

export function findings(d: ReportData, readShot: ReadShot): string {
  const o = ["<h2>Findings</h2>"];
  if (!d.confirmed.length) o.push(`<p class="muted">No confirmed findings.</p>`);
  for (const sev of SEVERITY_ORDER) {
    const group = d.confirmed.filter((f) => f.severity === sev);
    if (group.length) o.push(`<h3>${esc(sev)} (${group.length})</h3>`, ...group.map((f) => finding(f, readShot)));
  }
  return o.join("");
}

function loadResult(r: LoadResult): string {
  const rows = r.phases.map((p) => `<tr><td>${esc(String(p.connections))}</td><td>${esc(String(Math.round(p.rps)))}</td><td>${esc(String(p.latency.p50))} ms</td><td>${esc(String(p.latency.p90))} ms</td><td>${esc(String(p.latency.p99))} ms</td><td>${(p.errorRate * 100).toFixed(1)}%</td></tr>`).join("");
  const o = [`<section class="card load"><h3>${esc(r.method.toUpperCase())} ${esc(r.url)} <span class="muted">(${esc(r.profile)})</span></h3>`];
  const chart = latencyChart(r);
  if (chart) o.push(`<div class="scroll">${chart}</div>`, `<div class="legend"><span><i style="background:var(--p50)"></i>p50</span><span><i style="background:var(--p99)"></i>p99</span><span><i style="background:var(--err)"></i>error rate (right axis)</span><span><i style="border:2px dashed var(--bp);background:none"></i>breaking point</span></div>`);
  o.push(`<div class="scroll"><table><thead><tr><th>Connections</th><th>RPS</th><th>p50</th><th>p90</th><th>p99</th><th>Error rate</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  o.push(r.breakingPoint
    ? `<p>Breaking point: <b>${esc(String(r.breakingPoint.connections))}</b> connections — ${esc(r.breakingPoint.reason)}</p>`
    : `<p class="muted">No breaking point found up to ${esc(String(Math.max(0, ...r.phases.map((p) => p.connections))))} connections.</p>`);
  if (r.crashed) o.push(`<p><b>Crashed under load</b>; recovered: ${r.recovered ? "yes" : "no"}</p>`);
  if (r.memory) o.push(`<p>Memory: ${esc(r.memory.slopeMbPerMin.toFixed(2))} MB/min (${r.memory.leakSuspected ? "leak suspected" : "stable"})</p>`);
  o.push("</section>");
  return o.join("");
}

export function load(d: ReportData): string {
  return d.load.length ? `<h2>Load testing</h2>${d.load.map(loadResult).join("")}` : "";
}

export function tail(d: ReportData): string {
  const c = d.coverage;
  const o = [`<h2>Coverage</h2><div class="card cov"><ul>`,
    li([`Stages: ${esc(STAGES.map((s) => `${s}: ${c.stages[s]}`).join(", "))}`,
      `Personas: ${esc(c.personas.length ? c.personas.join(", ") : "none")}`,
      `Routes visited: ${c.visitedRoutes.length}/${c.discoveredRoutes.length}${c.unvisitedRoutes.length ? `; not visited: ${c.unvisitedRoutes.map((r) => `<code>${esc(r)}</code>`).join(", ")}` : ""}`]),
    "</ul></div>"];
  if (d.unconfirmed.length) o.push(`<h2>Unconfirmed / flaky</h2><div class="card cov"><ul>${li(d.unconfirmed.map((f) => `<span class="id">${esc(f.id)}</span> ${esc(f.title)}`))}</ul></div>`);
  if (d.warnings.length) o.push(`<h2>Warnings</h2><div class="card cov"><ul>${li(d.warnings.map(esc))}</ul></div>`);
  return o.join("");
}
