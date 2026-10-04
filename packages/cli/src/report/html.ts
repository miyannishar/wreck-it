import { readFileSync } from "node:fs";
import { join } from "node:path";
import { wreckPaths } from "../paths.js";
import { setStage } from "../run.js";
import { writeAtomic } from "../findings.js";
import type { Band } from "../score.js";
import { buildReportData, type ReportData } from "./data.js";
import { renderMarkdown } from "./markdown.js";
import { escapeHtml as esc } from "./escape.js";
import { STYLES } from "./html-styles.js";
import * as S from "./html-sections.js";

export function renderHtml(d: ReportData, readShot: S.ReadShot): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>wreck-it report — ${esc(d.projectName)}</title>
<style>${STYLES}</style></head>
<body><main>
${S.header(d)}
${S.categories(d)}
${S.findings(d, readShot)}
${S.load(d)}
${S.tail(d)}
<footer>Generated ${esc(d.generatedAt)} by wreck-it. Wreck your app before your users do.</footer>
</main></body></html>
`;
}

export async function writeReport(root: string): Promise<{ html: string; md: string; score: number; band: Band; warnings: string[] }> {
  const p = wreckPaths(root);
  const d = await buildReportData(root);
  const readShot = (rel: string): Buffer | null => {
    try { return readFileSync(join(p.dir, rel)); } catch { return null; }
  };
  await writeAtomic(p.reportHtml, renderHtml(d, readShot));
  await writeAtomic(p.reportMd, renderMarkdown(d));
  try { await setStage(root, "report", "done"); } catch { /* never fail the report over run state */ }
  return { html: p.reportHtml, md: p.reportMd, score: d.score.score, band: d.score.band, warnings: d.warnings };
}
