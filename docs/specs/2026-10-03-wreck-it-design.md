# wreck-it — Design Spec

**Date:** 2026-10-03
**Status:** Approved. Security module (§6.5) deferred out of v1 — see `TODO.md`.
**Tagline:** Wreck your app before your users do.

## 1. Purpose

Vibe-coded apps ship fast and untested. wreck-it is an open-source, agent-agnostic testing toolkit that lets any coding agent (Claude Code, Codex, Cursor, Gemini CLI, Copilot, …) test a locally running web app the way real users, clumsy beginners, chaos monkeys, traffic spikes, and attackers would — then produce a bug report that points at the code responsible.

### Goals
- Zero-config first run: "wreck my app" produces a useful report.
- Works in any agent that supports Agent Skills + Playwright MCP.
- Every finding has repro steps, screenshots, the likely source `file:line` with reasoning, and a regression Playwright test.
- Deterministic, comparable readiness score across runs and agents.
- Popular-OSS quality: easy install, great README/demo.

### Non-goals (v1)
- Auto-fixing bugs (report-only; fix mode is a future version).
- Testing remote/production targets by default.
- Native mobile or desktop apps (web apps only).
- Running in CI without an agent.

### Success criteria
- On `examples/buggy-app`: ≥80% of ~20 seeded bugs found, ≤2 false positives, on Claude Code and at least one other agent.
- Install-to-report in under 5 minutes on a fresh Next.js app.

## 2. Architecture

Skills (judgment) + a small npm CLI (determinism). The agent drives the browser via Playwright MCP and reasons about bugs; the CLI owns discovery, load generation, the findings schema, scoring, reports, and test generation. The CLI calls no LLM and needs no API key.

### Repo layout
```
wreck-it/
├── skills/
│   ├── wreck-it/SKILL.md         # orchestrator: full run
│   ├── wreck-personas/SKILL.md   # derive personas → .wreck-it/personas.md
│   ├── wreck-explore/SKILL.md    # normal-user pass + persona exploration
│   ├── wreck-chaos/SKILL.md      # hostile inputs, misuse, network faults, a11y
│   ├── wreck-load/SKILL.md       # choose targets, run CLI load, interpret
│   ├── wreck-security/SKILL.md   # detection-only security checks
│   └── wreck-trace/SKILL.md      # finding → source file:line + why
├── packages/cli/                 # npm "wreck-it" (TypeScript, Node ≥ 20)
├── .claude-plugin/               # Claude Code: /wreck command, persona subagents
├── AGENTS.md.snippet             # fallback for agents without skills support
└── examples/buggy-app/           # Next.js app with ~20 seeded bugs
```

### Run pipeline (orchestrated by `wreck-it` skill)
1. **Preflight** — app reachable; target is localhost/private IP (else require `--i-own-this`); Playwright MCP present (else print per-agent install snippet).
2. **Discover** — `npx wreck-it discover` → `.wreck-it/discovery.json` (routes, API endpoints, forms, auth method).
3. **Personas** — derive 2–3 ICP personas + built-ins → `.wreck-it/personas.md` (user-editable; reused if present).
4. **Normal-user pass** — happy paths + data-integrity invariants.
5. **Persona exploration** — ICP + beginner personas run missions (parallel subagents on Claude Code, sequential elsewhere).
6. **Chaos.**
7. **Load.**
8. **Security.**
9. **Trace** — map each finding to source.
10. **Report** — `wreck-it report` + `wreck-it gen-tests`.

Each stage is also invocable alone ("just stress test my API"). The oddity detector runs passively on every page visited in stages 4–6.

## 3. CLI (`packages/cli`)

| Command | Responsibility |
|---|---|
| `wreck-it discover` | Static scan of the project for routes, API endpoints, forms, auth. Adapters: Next.js (app + pages router), Express/Fastify/Hono, Vite/React Router, SvelteKit, Remix. Unknown framework → empty static result; skills fall back to crawling. |
| `wreck-it finding add <json>` | Validate against zod schema, assign `WR-NNN` id, write `.wreck-it/findings/<id>.json`. Rejects invalid input with a precise error. |
| `wreck-it oddity-scan` | Emits an injectable browser script (run via Playwright MCP `evaluate`) that returns automated oddity signals for the current page. |
| `wreck-it load` | autocannon (bundled) ramp/spike/soak profiles; samples target process memory when PID known; writes `.wreck-it/load/<route>.json`. |
| `wreck-it report` | Compute score; render self-contained `report.html` and `report.md` from whatever findings exist. |
| `wreck-it gen-tests` | Convert structured `steps` of reproduced findings into `tests/wreck-it/<id>.spec.ts`; scaffold minimal `playwright.config.ts` if absent. |

Config: `.wreck-it/config.json` — `baseUrl`, credentials (two test accounts for IDOR), `allowMutatingLoad` (default false), `iOwnThis` (default false), excluded routes.

## 4. Finding schema

```jsonc
{
  "id": "WR-007",
  "title": "Checkout crashes when coupon field has spaces",
  "category": "functional | ux | oddity | chaos | performance | security | accessibility",
  "severity": "critical | high | medium | low",
  "persona": "rushed-beginner",
  "route": "/checkout",
  "steps": [
    { "action": "goto | click | fill | select | press | wait | setOffline | reload | back",
      "target": "role=textbox[name='Coupon']", "value": " SAVE10 " }
  ],
  "expected": "string",
  "actual": "string",
  "evidence": {
    "screenshots": ["shots/WR-007-1.png"],
    "console": ["string"],
    "network": [{ "method": "POST", "url": "/api/coupon", "status": 500 }]
  },
  "source": {
    "file": "src/app/api/coupon/route.ts", "line": 42,
    "snippet": "string", "why": "string",
    "confidence": "high | medium | low",
    "candidates": ["string"]           // when confidence is low
  },
  "reproduced": true
}
```

Rules:
- Steps are structured (not prose) so `gen-tests` is deterministic. Targets prefer role/label locators.
- A finding is `reproduced: true` only after replaying `steps` in a fresh browser context. Unreproduced findings appear under "Flaky / unconfirmed" and do not affect the score.
- Never invent a source location: low confidence lists `candidates` instead of a guessed line.
- Load and security findings may have non-browser steps (e.g., the `wreck-it load` invocation or curl request) recorded in `steps` with `action: "http"`.

## 5. Readiness score

- Start at 100. Deduct per reproduced finding: critical −25, high −10, medium −4, low −1.
- Per-category deduction caps: functional 60, security 50, performance 40, chaos 30, ux 20, oddity 15, accessibility 15.
- Any reproduced critical → score capped at 49.
- Floor 0. Bands: 0–49 Not ready · 50–74 Risky · 75–89 Almost there · 90+ Ship it.
- Report shows overall score, per-category subscores, and coverage (personas run, routes visited vs. discovered, stages completed). Incomplete runs are labeled as such.

## 6. Testing modules

### 6.0 Normal-user pass (`wreck-explore`, persona `normal-user`)
- Walk every core flow as intended: sign-up, login, CRUD, search, checkout, settings, logout (flows derived from discovery).
- Data-integrity invariants: created items appear in lists; edits persist after reload; deletes disappear everywhere; counts/totals are arithmetically correct; state survives logout/login.
- Critical failures here are surfaced first in the report ("core flows broken").

### 6.1 Persona exploration (`wreck-personas`, `wreck-explore`)
- Personas derived from README, landing copy, routes, DB schema. Fields: goal, tech-savviness, patience, device/viewport, network profile, priority features.
- Built-ins always added: `normal-user`, `rushed-beginner`, `chaos-monkey`.
- Each persona receives missions (e.g., "sign up and create your first project") and acts in character; the beginner skips instructions, double-clicks, mistypes field formats, abandons midway.
- Auth: self sign-up when possible; else credentials from config. Storage state saved and reused.
- Per-action time budget; being stuck is itself a reportable finding.

### 6.2 Oddity detector (passive, every page)
- Automated (via `oddity-scan`): rendered `undefined`/`NaN`/`null`/`[object Object]`/`{{…}}`/Lorem ipsum; broken images; dead links; horizontal overflow and overlapping elements; console errors; failed requests; slow LCP.
- Agent judgment (screenshots): weird layout, confusing UX, inconsistent naming, mismatched date/currency formats, title/content mismatch, empty states without guidance, spinners that never resolve, buttons with no effect.
- Category `oddity`, usually low/medium; escalate to `functional` when it misleads users or loses data.

### 6.3 Chaos (`wreck-chaos`)
- Hostile inputs on every form: empty, max-length overflow, unicode/emoji, negative/huge numbers, SQL/HTML fragments.
- Double-submit and rapid clicks.
- Navigation abuse: back/forward/refresh mid-flow; multiple tabs on the same flow.
- Network faults via Playwright routing: slow 3G, offline mid-request, injected 500s.
- Accessibility: axe-core scan + keyboard-only navigation of core flows.

### 6.4 Load & stress (`wreck-load` + `wreck-it load`)
- Profiles: ramp (10→500 connections until error rate or p95 threshold breaks), spike (10× burst), soak (2–5 min steady; memory trend for leaks).
- Output: p50/p95/p99 latency, throughput, error rate, breaking point, memory trend.
- Agent traces slow endpoints to causes (N+1 queries, missing indexes, sync blocking work, unbounded queries).
- Safety: GET-only unless `allowMutatingLoad`; warn if DB connection string looks remote; refuse non-localhost/private targets.
- An app crash under load is a critical finding; the tool waits for recovery or ends the stage gracefully.

### 6.5 Security (`wreck-security`) — DEFERRED, not in v1 (see TODO.md)
- IDOR / broken access control (two accounts: A attempts to read/modify B's resources).
- Auth bypass on protected routes; leaked stack traces, `.env`, exposed source maps.
- Reflected XSS and basic injection probes.
- Security headers, cookie flags, permissive CORS.
- Secrets in client JS bundles.
- Detection only: confirm the issue minimally, never exploit beyond confirmation; localhost-only by default. These rules are stated explicitly in the skill.

## 7. Source tracing (`wreck-trace`)
- Inputs: finding evidence (console stack, failing request URL, route), discovery map.
- Method: map route/endpoint → handler file via discovery; follow stack frames (source maps when available); grep for UI strings and selectors; read the handler and identify the faulty line.
- Output: `source` block with file, line, snippet, `why`, confidence. Low confidence → `candidates`, no guessed line.

## 8. Report
- `.wreck-it/report.html` (single self-contained file, embedded screenshots and charts) and `.wreck-it/report.md`.
- Sections: score + "fix this first" line; findings by severity (steps, screenshots, source + snippet + why, link to generated test); load charts (latency/error vs. concurrency, breaking point); coverage; flaky/unconfirmed findings.
- Generated tests: `tests/wreck-it/WR-NNN.spec.ts`, one per reproduced browser finding; each fails while the bug exists and passes once fixed.

## 9. Error handling
- App not running: detect `dev` script, offer to start it or print the command; poll the port until ready.
- Playwright MCP missing: print the exact install snippet for the detected agent; do not silently degrade.
- Mid-run failure: findings persist incrementally; `report` works on partial data and lists incomplete stages.
- Untraceable bug: report it with low confidence and candidates.
- Invalid finding JSON: CLI rejects with a field-level error so the agent can correct it.

## 10. Cross-agent compatibility
- Skills use only Markdown instructions, shell (`npx wreck-it …`), and standard Playwright MCP tool names.
- Claude Code extras: `/wreck` slash command; personas as parallel subagents.
- Others run stages sequentially. `AGENTS.md.snippet` for agents without skills support.

## 11. Testing wreck-it
- CLI unit tests: schema validation, scoring (including caps and critical cap), report rendering snapshots, gen-tests output.
- CLI integration: `discover` against fixture projects per framework adapter; `load` against a fixture server with a known breaking point.
- End-to-end eval: `examples/buggy-app` (Next.js) with ~20 seeded bugs across all categories (e.g., wrong cart total, IDOR, N+1 endpoint, rendered `undefined`, double-submit duplicate order, missing index, XSS, leaked secret in bundle, broken image, overflow on mobile). A manifest lists expected bugs; a script compares report findings to the manifest and prints recall / false positives.
- Release gate: ≥80% recall, ≤2 false positives on Claude Code + one other agent.

## 12. Distribution
- npm `wreck-it` (fallback `wreckit` or `@wreck-it/cli` if taken — check before first publish).
- Skills via `npx skills add <owner>/wreck-it`; Claude Code via `.claude-plugin` marketplace entry.
- README: GIF of a run on buggy-app, quickstart, per-agent setup, safety notes. Avoid Disney/Ralph imagery.

## 13. Milestones (single v1 release)
1. CLI core: schema, `finding add`, scoring, report, gen-tests + buggy-app skeleton.
2. Discover + normal-user pass + oddity detector + persona exploration + trace.
3. Chaos.
4. Load & stress.
5. Security.
6. Claude Code plugin wrapper, cross-agent verification, README/demo, release.

Each milestone is independently demoable against buggy-app before the next starts.
