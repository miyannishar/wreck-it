import { describe, it, expect } from "vitest";
import { inScope } from "../src/context.js";
import { initRun } from "../src/run.js";
import { buildReportData } from "../src/report/data.js";
import { renderMarkdown } from "../src/report/markdown.js";
import { tmpRoot } from "./helpers.js";

describe("focused runs", () => {
  it("scopes routes to the given ones and everything below them", () => {
    expect(inScope("/cart", ["/cart"])).toBe(true);
    expect(inScope("/cart/checkout?step=2", ["/cart/"])).toBe(true);
    expect(inScope("/cartoons", ["/cart"])).toBe(false);
    expect(inScope("/products/[id]", ["/products"])).toBe(true);
    expect(inScope("/about", ["/"])).toBe(false);
    expect(inScope("/anything", undefined)).toBe(true);
  });

  it("labels the report as a feature score, not app readiness", async () => {
    const root = await tmpRoot();
    await initRun(root, { fresh: false, focus: "checkout" });
    const md = renderMarkdown(await buildReportData(root));
    expect(md).toContain("**Focused run — checkout: 100/100 — Ship it**");
    expect(md).toContain("not the whole app");
    expect(md).not.toContain("**Readiness:");
  });
});
