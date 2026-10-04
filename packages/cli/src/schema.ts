import { z } from "zod";

export const CATEGORIES = ["functional", "ux", "oddity", "chaos", "performance", "security", "accessibility"] as const;
export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Severity = (typeof SEVERITIES)[number];

export const TargetSchema = z.discriminatedUnion("by", [
  z.strictObject({ by: z.literal("role"), role: z.string().min(1), name: z.string().optional(), exact: z.boolean().optional() }),
  z.strictObject({ by: z.literal("label"), value: z.string().min(1) }),
  z.strictObject({ by: z.literal("text"), value: z.string().min(1) }),
  z.strictObject({ by: z.literal("placeholder"), value: z.string().min(1) }),
  z.strictObject({ by: z.literal("testId"), value: z.string().min(1) }),
  z.strictObject({ by: z.literal("css"), value: z.string().min(1) }),
]);
export type Target = z.infer<typeof TargetSchema>;

export const StepSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("goto"), url: z.string().min(1) }),
  z.strictObject({ action: z.literal("click"), target: TargetSchema, count: z.number().int().min(1).max(10).optional() }),
  z.strictObject({ action: z.literal("fill"), target: TargetSchema, value: z.string() }),
  z.strictObject({ action: z.literal("select"), target: TargetSchema, value: z.string() }),
  z.strictObject({ action: z.literal("check"), target: TargetSchema }),
  z.strictObject({ action: z.literal("uncheck"), target: TargetSchema }),
  z.strictObject({ action: z.literal("hover"), target: TargetSchema }),
  z.strictObject({ action: z.literal("press"), key: z.string().min(1), target: TargetSchema.optional() }),
  z.strictObject({ action: z.literal("wait"), ms: z.number().int().min(0).max(60_000) }),
  z.strictObject({ action: z.literal("reload") }),
  z.strictObject({ action: z.literal("back") }),
  z.strictObject({ action: z.literal("forward") }),
  z.strictObject({ action: z.literal("setOffline"), offline: z.boolean() }),
  z.strictObject({ action: z.literal("setViewport"), width: z.number().int().positive(), height: z.number().int().positive() }),
  z.strictObject({
    action: z.literal("http"),
    method: z.string().min(1),
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
  }),
]);
export type Step = z.infer<typeof StepSchema>;

/** Assertions describe CORRECT behavior. Generated tests fail while the bug exists. */
export const AssertionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("visible"), target: TargetSchema }),
  z.strictObject({ kind: z.literal("hidden"), target: TargetSchema }),
  z.strictObject({ kind: z.literal("text"), target: TargetSchema, contains: z.string(), negate: z.boolean().optional() }),
  z.strictObject({ kind: z.literal("url"), contains: z.string().min(1) }),
  z.strictObject({ kind: z.literal("count"), target: TargetSchema, equals: z.number().int().min(0) }),
  z.strictObject({ kind: z.literal("noConsoleErrors") }),
  z.strictObject({ kind: z.literal("noServerErrors") }),
  z.strictObject({ kind: z.literal("httpStatus"), equals: z.number().int().optional(), below: z.number().int().optional(), atLeast: z.number().int().optional() }),
]);
export type Assertion = z.infer<typeof AssertionSchema>;

export const SourceSchema = z
  .strictObject({
    file: z.string().min(1).optional(),
    line: z.number().int().positive().optional(),
    snippet: z.string().optional(),
    why: z.string().min(1),
    confidence: z.enum(["high", "medium", "low"]),
    candidates: z.array(z.string().min(1)).default([]),
  })
  .superRefine((s, ctx) => {
    if (s.confidence === "low") {
      if (s.line !== undefined) ctx.addIssue({ code: "custom", path: ["line"], message: "low-confidence sources must not claim a line; list candidates instead" });
      if (s.candidates.length === 0) ctx.addIssue({ code: "custom", path: ["candidates"], message: "low-confidence sources need at least one candidate file" });
    } else {
      if (!s.file) ctx.addIssue({ code: "custom", path: ["file"], message: "high/medium confidence requires file" });
      if (s.line === undefined) ctx.addIssue({ code: "custom", path: ["line"], message: "high/medium confidence requires line" });
    }
  });

export const EvidenceSchema = z.strictObject({
  screenshots: z.array(z.string()).default([]),
  console: z.array(z.string()).default([]),
  network: z.array(z.strictObject({ method: z.string(), url: z.string(), status: z.number().int() })).default([]),
});

const findingFields = {
  title: z.string().min(3).max(200),
  category: z.enum(CATEGORIES),
  severity: z.enum(SEVERITIES),
  persona: z.string().min(1).default("unknown"),
  route: z.string().min(1),
  steps: z.array(StepSchema).min(1),
  assertions: z.array(AssertionSchema).default([]),
  expected: z.string().min(1),
  actual: z.string().min(1),
  evidence: EvidenceSchema.default({ screenshots: [], console: [], network: [] }),
  source: SourceSchema.optional(),
  reproduced: z.boolean().default(false),
};

type Refinable = { steps: { action: string }[]; assertions: { kind: string }[] };
const needsHttpStep = (f: Refinable, ctx: z.RefinementCtx): void => {
  if (f.assertions.some((a) => a.kind === "httpStatus") && !f.steps.some((s) => s.action === "http")) {
    ctx.addIssue({ code: "custom", path: ["assertions"], message: "httpStatus assertions need an http step" });
  }
};

export const FindingInputSchema = z.strictObject(findingFields).superRefine(needsHttpStep);
export type FindingInput = z.input<typeof FindingInputSchema>;

export const FindingSchema = z
  .strictObject({ ...findingFields, id: z.string().regex(/^WR-\d{3,}$/), createdAt: z.string() })
  .superRefine(needsHttpStep);
export type Finding = z.output<typeof FindingSchema>;

export function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`).join("\n");
}
