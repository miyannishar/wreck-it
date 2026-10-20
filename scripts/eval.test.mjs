import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { evaluate, routeMatches, matchScore, loadFindings } from "./eval.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = {
  bugs: [
    { id: "B01", title: "total ignores qty", category: "functional", routes: ["/cart"], file: "lib/cart.ts", line: 19, keywords: ["quantity", "subtotal"] },
    { id: "B02", title: "undefined rating", category: "oddity", routes: ["/products"], file: "components/ProductCard.tsx", line: 14, keywords: ["undefined"] },
    { id: "B03", title: "dead link", category: "oddity", routes: ["*"], file: "components/Footer.tsx", line: 16, keywords: ["pricng"] },
    { id: "B04", title: "order detail date", category: "oddity", routes: ["/orders/[id]"], file: "app/orders/[id]/page.tsx", line: 21, keywords: ["iso"] },
  ],
};
const f = (id, o) => ({ id, title: "x", actual: "y", expected: "z", category: "functional", route: "/", reproduced: true, ...o });

test("route patterns", () => {
  assert.ok(routeMatches("/orders/[id]", "/orders/1003"));
  assert.ok(routeMatches("/orders/[id]", "http://localhost:3000/orders/1003?x=1"));
  assert.ok(!routeMatches("/orders/[id]", "/orders"));
  assert.ok(routeMatches("*", "/anything"));
  assert.ok(routeMatches("/cart", "/cart/"));
});

test("recall, duplicates, false positives, unconfirmed", () => {
  const findings = [
    f("WR-001", { route: "/cart", title: "Subtotal ignores quantity" }),
    f("WR-002", { route: "/cart", title: "Cart subtotal wrong with quantity 2" }), // duplicate of B01
    f("WR-003", { route: "/about", title: "Footer link /pricng is 404", category: "oddity" }),
    f("WR-004", { route: "/orders/1003", title: "Date shown as ISO string", category: "oddity" }),
    f("WR-005", { route: "/login", title: "Login button misaligned" }), // FP
    f("WR-006", { route: "/products", title: "Rating shows undefined", reproduced: false }), // ignored
  ];
  const r = evaluate(manifest, findings);
  assert.equal(r.found, 3);
  assert.equal(r.recall, 0.75);
  assert.deepEqual(r.duplicates, [{ finding: "WR-002", bug: "B01" }]);
  assert.deepEqual(r.falsePositives.map((x) => x.finding), ["WR-005"]);
  assert.deepEqual(r.unconfirmed, ["WR-006"]);
  assert.equal(r.pass, false);
});

test("findings matching manifest extras are neither hits nor false positives", () => {
  const m = { ...manifest, extras: [{ id: "X01", title: "oversell", routes: ["/cart"], file: "app/api/cart/route.ts", keywords: ["stock"] }] };
  const r = evaluate(m, [f("WR-001", { route: "/cart", title: "Cart oversells beyond stock" }), f("WR-002", { route: "/x", title: "zzz" })]);
  assert.deepEqual(r.extras, [{ finding: "WR-001", extra: "X01" }]);
  assert.deepEqual(r.falsePositives.map((x) => x.finding), ["WR-002"]);
});

test("source supports behavioral evidence, never replaces it; candidates count", () => {
  assert.ok(matchScore(f("WR-1", { title: "subtotal ignores quantity", route: "/checkout", source: { file: "lib/cart.ts", line: 19, confidence: "high" } }), manifest.bugs[0]) > 0);
  assert.ok(matchScore(f("WR-2", { title: "Dead pricng link", route: "/x", source: { confidence: "low", candidates: ["components/Footer.tsx:16?"] } }), manifest.bugs[2]) > 0);
  assert.equal(matchScore(f("WR-3", { title: "Unrelated defect", source: { file: "lib/cart.ts", line: 19 } }), manifest.bugs[0]), 0);
  assert.equal(matchScore(f("WR-3", { route: "/x", title: "unrelated" }), manifest.bugs[0]), 0);
});

const actualManifest = JSON.parse(readFileSync(join(here, "..", "examples/buggy-app/wreck-manifest.json"), "utf8"));
const archive = (agent) => readdirSync(join(here, "../docs/evals/2026-10-20", agent, "findings")).map((name) => JSON.parse(readFileSync(join(here, "../docs/evals/2026-10-20", agent, "findings", name), "utf8")));

test("same source and page snapshot cannot invent empty-cart, duplicate-order or rating matches", () => {
  const codex = archive("codex"), sonnet = archive("sonnet");
  for (const [id, bug] of [["WR-033", "B12"], ["WR-035", "B15"], ["WR-010", "B06"]]) {
    assert.equal(matchScore(codex.find((f) => f.id === id), actualManifest.bugs.find((b) => b.id === bug)), 0, `${id} != ${bug}`);
  }
  assert.equal(matchScore(sonnet.find((f) => f.id === "WR-021"), actualManifest.bugs.find((b) => b.id === "B06")), 0);
});

test("rescoring frozen discoveries preserves reviewed recall and correct root causes", () => {
  const codex = evaluate(actualManifest, archive("codex"));
  const sonnet = evaluate(actualManifest, archive("sonnet"));
  assert.equal(codex.found, 21);
  assert.equal(sonnet.found, 19);
  assert.equal(codex.bugs.find((b) => b.id === "B12").found, false);
  assert.equal(codex.bugs.find((b) => b.id === "B15").finding, "WR-024");
  assert.ok(sonnet.extras.some((e) => e.finding === "WR-021" && e.extra === "X07"));
});

test("each bug matched once; best-scoring finding wins", () => {
  const r = evaluate(manifest, [
    f("WR-001", { route: "/cart", title: "subtotal off" }),
    f("WR-002", { route: "/cart", title: "subtotal off", source: { file: "lib/cart.ts", line: 19, confidence: "high" } }),
  ]);
  assert.equal(r.bugs[0].finding, "WR-002");
  assert.deepEqual(r.duplicates, [{ finding: "WR-001", bug: "B01" }]);
});

test("ties need review and stronger extras cannot inflate seeded recall", () => {
  const bug = manifest.bugs[0];
  const finding = f("WR-001", { route: "/cart", title: "Subtotal ignores quantity" });
  const tied = evaluate({ bugs: [bug, { ...bug, id: "B99" }] }, [finding]);
  assert.equal(tied.found, 0);
  assert.deepEqual(tied.ambiguous, [{ finding: "WR-001", candidates: ["B01", "B99"] }]);
  assert.equal(tied.pass, false);
  const extra = evaluate({ bugs: [bug], extras: [{ ...bug, id: "X01", keywords: ["quantity", "subtotal", "ignores"] }] }, [finding]);
  assert.equal(extra.found, 0);
  assert.deepEqual(extra.extras, [{ finding: "WR-001", extra: "X01" }]);
});

test("CLI: skips corrupt files, passes gate, exit 0", () => {
  const app = mkdtempSync(join(tmpdir(), "wreck-eval-"));
  writeFileSync(join(app, "wreck-manifest.json"), JSON.stringify({ bugs: manifest.bugs.slice(0, 1) }));
  mkdirSync(join(app, ".wreck-it", "findings"), { recursive: true });
  writeFileSync(join(app, ".wreck-it", "findings", "WR-001.json"), JSON.stringify(f("WR-001", { route: "/cart", title: "subtotal ignores quantity" })));
  writeFileSync(join(app, ".wreck-it", "findings", "WR-002.json"), "{not json");
  assert.equal(loadFindings(app).warnings.length, 1);
  const out = execFileSync("node", [join(here, "eval.mjs"), "--app", app, "--json"], { stdio: ["ignore", "pipe", "ignore"] }).toString();
  assert.equal(JSON.parse(out).pass, true);
});

test("real manifest is well-formed", () => {
  const m = JSON.parse(readFileSync(join(here, "..", "examples", "buggy-app", "wreck-manifest.json"), "utf8"));
  assert.ok(m.bugs.length >= 17);
  assert.equal(new Set(m.bugs.map((b) => b.id)).size, m.bugs.length);
  for (const b of m.bugs) {
    assert.ok(b.file && b.line && b.keywords.length && (b.routes?.length || b.route), b.id);
    assert.notEqual(b.category, "security", b.id);
  }
});
