#!/usr/bin/env node
// Compare wreck-it findings against a seeded-bug manifest: recall, false positives, release gate.
// Usage: node scripts/eval.mjs [--app examples/buggy-app] [--root <dir containing .wreck-it>] [--json]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GATE = { recall: 0.8, maxFalsePositives: 2 };

const norm = (s) => String(s ?? "").toLowerCase();
const posix = (p) => norm(p).replace(/\\/g, "/").replace(/^\.\//, "");

export function normalizeRoute(r) {
  let s = String(r ?? "").trim();
  try { if (/^https?:/i.test(s)) s = new URL(s).pathname; } catch { /* keep as is */ }
  s = s.split(/[?#]/)[0] || "/";
  if (!s.startsWith("/")) s = "/" + s;
  return s.length > 1 ? s.replace(/\/+$/, "") : s;
}

export function routeMatches(pattern, route) {
  if (pattern === "*") return true;
  const re = new RegExp("^" + normalizeRoute(pattern).split("/").map((seg) => /^\[.+\]$/.test(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|\\]/g, "\\$&")).join("/") + "$");
  return re.test(normalizeRoute(route));
}

const fileHit = (finding, bugFile) => {
  const s = finding.source;
  if (!s) return false;
  const files = [s.file, ...(s.candidates ?? []).map((c) => String(c).replace(/:\d+\??$/, "").replace(/\?$/, ""))].filter(Boolean).map(posix);
  const b = posix(bugFile);
  return files.some((f) => f === b || f.endsWith("/" + b));
};

/** Score how well a finding matches a bug; 0 = no match. */
export function matchScore(finding, bug) {
  const routes = bug.routes ?? [bug.route];
  const route = routes.some((p) => routeMatches(p, finding.route ?? ""));
  const file = fileHit(finding, bug.file);
  const text = norm(`${finding.title} ${finding.actual} ${finding.expected}`);
  const kw = (bug.keywords ?? []).filter((k) => text.includes(norm(k))).length;
  if (!(route || file) || !(file || kw > 0)) return 0;
  const lineClose = file && finding.source?.line && bug.line && Math.abs(finding.source.line - bug.line) <= 5 ? 3 : 0;
  return (file ? 4 : 0) + lineClose + (route ? 1 : 0) + Math.min(kw, 3) + (finding.category === bug.category ? 1 : 0);
}

export function evaluate(manifest, findings) {
  const confirmed = findings.filter((f) => f.reproduced);
  const unconfirmed = findings.filter((f) => !f.reproduced);
  const pairs = [];
  for (const f of confirmed) for (const b of manifest.bugs) { const s = matchScore(f, b); if (s > 0) pairs.push({ f, b, s }); }
  pairs.sort((x, y) => y.s - x.s || String(x.f.id).localeCompare(String(y.f.id)));
  const bugTo = new Map(), findingTo = new Map();
  for (const { f, b, s } of pairs) {
    if (bugTo.has(b.id) || findingTo.has(f.id)) continue;
    bugTo.set(b.id, { finding: f.id, score: s }); findingTo.set(f.id, b.id);
  }
  const duplicates = [], falsePositives = [], extras = [];
  for (const f of confirmed) {
    if (findingTo.has(f.id)) continue;
    const dup = pairs.find((p) => p.f === f && bugTo.has(p.b.id)); // pairs are sorted best-first
    // Real but unseeded issues listed in the manifest: neither a hit nor a false positive.
    const extra = (manifest.extras ?? []).map((x) => ({ x, s: matchScore(f, x) })).filter((e) => e.s > 0).sort((a, b) => b.s - a.s)[0];
    if (extra && (!dup || extra.s > dup.s)) extras.push({ finding: f.id, extra: extra.x.id });
    else if (dup) duplicates.push({ finding: f.id, bug: dup.b.id });
    else falsePositives.push({ finding: f.id, title: f.title, route: f.route });
  }
  const bugs = manifest.bugs.map((b) => ({ id: b.id, title: b.title, category: b.category, found: bugTo.has(b.id), finding: bugTo.get(b.id)?.finding ?? null }));
  const found = bugs.filter((b) => b.found).length;
  const recall = manifest.bugs.length ? found / manifest.bugs.length : 0;
  const pass = recall >= GATE.recall && falsePositives.length <= GATE.maxFalsePositives;
  return { total: manifest.bugs.length, found, recall, bugs, falsePositives, duplicates, extras, unconfirmed: unconfirmed.map((f) => f.id), pass };
}

export function loadFindings(root) {
  const dir = join(root, ".wreck-it", "findings");
  const findings = [], warnings = [];
  if (!existsSync(dir)) return { findings, warnings: [`no findings directory at ${dir}`] };
  for (const n of readdirSync(dir).filter((n) => /^WR-\d+\.json$/.test(n)).sort()) {
    try {
      const f = JSON.parse(readFileSync(join(dir, n), "utf8"));
      if (f && typeof f === "object" && f.id) findings.push(f); else warnings.push(`skipped ${n}: not a finding`);
    } catch (e) { warnings.push(`skipped ${n}: ${e.message}`); }
  }
  return { findings, warnings };
}

function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const app = resolve(arg("--app") ?? "examples/buggy-app");
  const root = resolve(arg("--root") ?? app);
  const manifestFile = join(app, "wreck-manifest.json");
  if (!existsSync(manifestFile)) { process.stderr.write(`eval: manifest not found: ${manifestFile}\n`); return 2; }
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const { findings, warnings } = loadFindings(root);
  for (const w of warnings) process.stderr.write(`warning: ${w}\n`);
  const r = evaluate(manifest, findings);
  if (argv.includes("--json")) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return r.pass ? 0 : 1; }
  const out = [];
  for (const b of r.bugs) out.push(`${b.found ? "✓" : "✗"} ${b.id}  ${b.category.padEnd(13)} ${(b.finding ?? "").padEnd(7)} ${b.title}`);
  out.push("");
  for (const d of r.duplicates) out.push(`duplicate: ${d.finding} → ${d.bug}`);
  for (const e of r.extras) out.push(`extra (real, unseeded): ${e.finding} → ${e.extra}`);
  for (const fp of r.falsePositives) out.push(`false positive: ${fp.finding} ${fp.route} ${fp.title}`);
  if (r.unconfirmed.length) out.push(`unconfirmed (ignored): ${r.unconfirmed.join(", ")}`);
  out.push(`recall ${r.found}/${r.total} = ${(r.recall * 100).toFixed(0)}%  ·  false positives ${r.falsePositives.length}  ·  gate (≥${GATE.recall * 100}% recall, ≤${GATE.maxFalsePositives} FP): ${r.pass ? "PASS" : "FAIL"}`);
  process.stdout.write(out.join("\n") + "\n");
  return r.pass ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
