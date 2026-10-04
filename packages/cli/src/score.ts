import { CATEGORIES, type Category, type Severity, type Finding } from "./schema.js";

export const SEVERITY_POINTS: Record<Severity, number> = { critical: 25, high: 10, medium: 4, low: 1 };
export const CATEGORY_CAPS: Record<Category, number> = {
  functional: 60, security: 50, performance: 40, chaos: 30, ux: 20, oddity: 15, accessibility: 15,
};
export type Band = "Not ready" | "Risky" | "Almost there" | "Ship it";
export interface CategoryScore { count: number; deduction: number; cap: number; subscore: number }
export interface ScoreResult {
  score: number; band: Band; criticalCap: boolean;
  categories: Record<Category, CategoryScore>; counted: number; ignoredUnreproduced: number;
}

export function bandFor(score: number): Band {
  if (score >= 90) return "Ship it";
  if (score >= 75) return "Almost there";
  if (score >= 50) return "Risky";
  return "Not ready";
}

export function computeScore(findings: Pick<Finding, "category" | "severity" | "reproduced">[]): ScoreResult {
  const raw = Object.fromEntries(CATEGORIES.map((c) => [c, { count: 0, points: 0 }])) as Record<Category, { count: number; points: number }>;
  let counted = 0, ignored = 0, hasCritical = false;
  for (const f of findings) {
    if (!f.reproduced) { ignored++; continue; }
    counted++;
    raw[f.category].count++;
    raw[f.category].points += SEVERITY_POINTS[f.severity];
    if (f.severity === "critical") hasCritical = true;
  }
  const categories = {} as Record<Category, CategoryScore>;
  let total = 0;
  for (const c of CATEGORIES) {
    const cap = CATEGORY_CAPS[c];
    const deduction = Math.min(raw[c].points, cap);
    total += deduction;
    categories[c] = { count: raw[c].count, deduction, cap, subscore: Math.round(100 * (1 - deduction / cap)) };
  }
  let score = Math.max(0, 100 - total);
  if (hasCritical) score = Math.min(score, 49);
  return { score, band: bandFor(score), criticalCap: hasCritical, categories, counted, ignoredUnreproduced: ignored };
}
