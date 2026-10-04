import { describe, it, expect } from "vitest";
import { computeScore, bandFor } from "../src/score.js";

const f = (category: string, severity: string, reproduced = true) => ({ category, severity, reproduced }) as any;

describe("computeScore", () => {
  it("is 100 / Ship it with no findings", () => {
    const s = computeScore([]);
    expect(s.score).toBe(100);
    expect(s.band).toBe("Ship it");
    expect(s.categories.functional.subscore).toBe(100);
  });
  it("deducts by severity", () => {
    expect(computeScore([f("functional", "high"), f("ux", "medium"), f("oddity", "low")]).score).toBe(85);
  });
  it("ignores unreproduced findings", () => {
    const s = computeScore([f("functional", "high", false)]);
    expect(s.score).toBe(100);
    expect(s.ignoredUnreproduced).toBe(1);
    expect(s.counted).toBe(0);
  });
  it("caps per category", () => {
    const s = computeScore(Array.from({ length: 30 }, () => f("oddity", "low")));
    expect(s.categories.oddity.deduction).toBe(15);
    expect(s.categories.oddity.subscore).toBe(0);
    expect(s.score).toBe(85);
  });
  it("any critical caps the score at 49", () => {
    const s = computeScore([f("performance", "critical")]);
    expect(s.score).toBe(49);
    expect(s.criticalCap).toBe(true);
    expect(s.band).toBe("Not ready");
  });
  it("floors at 0", () => {
    const many = ["functional", "security", "performance", "chaos", "ux", "oddity", "accessibility"].flatMap((c) =>
      Array.from({ length: 10 }, () => f(c, "critical")));
    expect(computeScore(many).score).toBe(0);
  });
  it("bands", () => {
    expect([49, 50, 74, 75, 89, 90].map(bandFor)).toEqual(["Not ready", "Risky", "Risky", "Almost there", "Almost there", "Ship it"]);
  });
});
