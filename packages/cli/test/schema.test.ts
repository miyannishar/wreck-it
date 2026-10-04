import { z } from "zod";
import { describe, it, expect } from "vitest";
import { FindingInputSchema, formatZodError } from "../src/schema.js";

const valid = {
  title: "Checkout crashes when coupon has spaces",
  category: "functional",
  severity: "high",
  persona: "rushed-beginner",
  route: "/checkout",
  steps: [
    { action: "goto", url: "/checkout" },
    { action: "fill", target: { by: "label", value: "Coupon" }, value: " SAVE10 " },
    { action: "click", target: { by: "role", role: "button", name: "Apply" } },
  ],
  assertions: [{ kind: "noServerErrors" }],
  expected: "Coupon applied or a friendly error",
  actual: "500 Internal Server Error",
};

describe("FindingInputSchema", () => {
  it("accepts a valid finding and fills defaults", () => {
    const f = FindingInputSchema.parse(valid);
    expect(f.reproduced).toBe(false);
    expect(f.evidence).toEqual({ screenshots: [], console: [], network: [] });
  });
  it("defaults assertions to [] and persona to 'unknown'", () => {
    const { assertions, persona, ...rest } = valid;
    const f = FindingInputSchema.parse(rest);
    expect(f.assertions).toEqual([]);
    expect(f.persona).toBe("unknown");
  });
  it("rejects unknown category with a readable path", () => {
    const r = FindingInputSchema.safeParse({ ...valid, category: "vibes" });
    expect(r.success).toBe(false);
    if (!r.success) expect(formatZodError(r.error)).toMatch(/^category: /m);
  });
  it("rejects empty steps", () => {
    expect(FindingInputSchema.safeParse({ ...valid, steps: [] }).success).toBe(false);
  });
  it("rejects a selector string as target", () => {
    expect(FindingInputSchema.safeParse({ ...valid, steps: [{ action: "click", target: "button.apply" }] }).success).toBe(false);
  });
  it("high/medium confidence source requires file and line", () => {
    expect(FindingInputSchema.safeParse({ ...valid, source: { why: "x", confidence: "high" } }).success).toBe(false);
  });
  it("low confidence source must not have a line and needs candidates", () => {
    expect(FindingInputSchema.safeParse({ ...valid, source: { why: "x", confidence: "low", line: 4, candidates: ["a.ts"] } }).success).toBe(false);
    expect(FindingInputSchema.safeParse({ ...valid, source: { why: "x", confidence: "low", candidates: [] } }).success).toBe(false);
    expect(FindingInputSchema.safeParse({ ...valid, source: { why: "x", confidence: "low", candidates: ["a.ts", "b.ts"] } }).success).toBe(true);
  });
  it("accepts http steps and httpStatus assertions", () => {
    const f = FindingInputSchema.parse({
      ...valid,
      steps: [{ action: "http", method: "GET", url: "/api/projects", headers: { accept: "application/json" } }],
      assertions: [{ kind: "httpStatus", below: 500 }],
    });
    expect(f.steps[0]!.action).toBe("http");
  });
  it("toJSONSchema still works and strict/refine hold", () => {
    expect(z.toJSONSchema(FindingInputSchema, { io: "input" })).toHaveProperty("properties.title");
    expect(FindingInputSchema.safeParse({ ...valid, reproducd: true }).success).toBe(false);
    expect(FindingInputSchema.safeParse({ ...valid, steps: [{ action: "goto", url: "/", extra: 1 }] }).success).toBe(false);
  });
});
