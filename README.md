# wreck-it

**Wreck your app before your users do.**

wreck-it makes your coding agent (Claude Code, Codex, Cursor, Gemini CLI, Copilot, …) test your **locally running web app** from several angles:

- **Normal users** walking every core flow
- **Your ideal customers**
- **Rushed beginners** on a phone
- **Chaos monkeys**
- **Traffic spikes**

You then get a bug report that points at the code responsible.

```
Readiness 41/100 (Not ready) → .wreck-it/report.html
Fix this first: WR-004 Double-clicking "Place order" creates two orders
                app/api/orders/route.ts:18 — no idempotency key; each POST inserts
```

Every finding comes with:
- **Repro steps and screenshots**, replayed in a fresh browser before the finding counts
- **The likely `file:line`** plus *why* it causes the bug. If wreck-it can't pin a line, it lists candidate files and doesn't guess.
- **A regression Playwright test** (`tests/wreck-it/WR-NNN.spec.ts`) that fails while the bug exists and passes once you fix it

On top of that you get a deterministic **readiness score** (0–100) you can compare across runs and agents.

## How it works

| Part | Does |
|---|---|
| **Skills** (`skills/`) | Judgment: derive personas, drive the browser through Playwright MCP, decide what's a bug, trace bugs to code |
| **CLI** (`npx wreck-it`) | Everything deterministic: route discovery, finding validation and storage, oddity detector, axe-core scans, autocannon load tests, scoring, HTML/Markdown report, test generation |

The CLI never calls an LLM and needs no API key.

Pipeline: preflight → discover → personas → normal-user pass → persona exploration → chaos and accessibility → load → trace → report. Each stage also runs on its own ("just stress test my API").

## Quickstart

1. Start your app locally (e.g. `npm run dev`).
2. Install Playwright MCP for your agent (see below).
3. Install the skills:
   ```bash
   npx skills add miyannishar/wreck-it
   ```
4. Ask your agent:
   > wreck my app

The report lands in `.wreck-it/report.html`. Add `.wreck-it/` to your `.gitignore`.

## Per-agent setup

| Agent | Playwright MCP | wreck-it |
|---|---|---|
| **Claude Code** | bundled with the plugin | `/plugin marketplace add miyannishar/wreck-it` then `/plugin install wreck-it@wreck-it`, then run `/wreck` (or `/wreck load`, `/wreck chaos`, …). Personas run as up to 3 parallel subagents, each in its own browser. |
| **Codex** | `codex mcp add playwright -- npx @playwright/mcp@latest` | `npx skills add miyannishar/wreck-it` |
| **Gemini CLI** | `gemini mcp add playwright npx @playwright/mcp@latest` | `npx skills add miyannishar/wreck-it` |
| **Cursor** | `.cursor/mcp.json`: `{"mcpServers":{"playwright":{"command":"npx","args":["@playwright/mcp@latest"]}}}` | `npx skills add miyannishar/wreck-it` |
| **VS Code / Copilot** | `.vscode/mcp.json`: `{"servers":{"playwright":{"command":"npx","args":["@playwright/mcp@latest"]}}}` | `npx skills add miyannishar/wreck-it` |
| **Anything else** | any Playwright MCP | paste [`AGENTS.md.snippet`](AGENTS.md.snippet) into your `AGENTS.md` |

`npx wreck-it preflight` tells you whether Playwright MCP is configured and prints the right install line for your agent.

## CLI reference

```bash
npx wreck-it discover                        # routes, API endpoints, forms, auth → .wreck-it/discovery.json
npx wreck-it preflight [--wait 30]           # target safety, app reachable, Playwright MCP present
npx wreck-it sweep [--record]                # every page × desktop/mobile: oddities + axe, deduplicated findings
npx wreck-it oddity-script                   # browser script: undefined/NaN on page, broken images, dead links, overflow…
npx wreck-it a11y <url…> [--record]          # axe-core scan in headless Chromium
npx wreck-it load <url> --profile ramp|spike|soak [--pid N]
npx wreck-it finding add|update|list         # validated findings → .wreck-it/findings/WR-NNN.json
npx wreck-it run init|stage|visit|show       # run state and coverage
npx wreck-it report                          # score + .wreck-it/report.html + report.md
npx wreck-it gen-tests                       # tests/wreck-it/WR-NNN.spec.ts
npx wreck-it schema finding|config           # JSON Schemas
```

Configure wreck-it in `.wreck-it/config.json`:

```json
{
  "baseUrl": "http://localhost:3000",
  "accounts": [{ "label": "A", "email": "a@example.com", "password": "…" }],
  "allowMutatingLoad": false,
  "iOwnThis": false,
  "exclude": ["/admin"],
  "thresholds": { "p99Ms": 2000, "errorRate": 0.01 }
}
```

## Readiness score

The score starts at 100 and loses points for each **reproduced** finding:

| Severity | Points |
|---|---|
| critical | −25 |
| high | −10 |
| medium | −4 |
| low | −1 |

Each category's total deduction is capped:

| Category | Cap |
|---|---|
| functional | 60 |
| security | 50 |
| performance | 40 |
| chaos | 30 |
| ux | 20 |
| oddity | 15 |
| accessibility | 15 |

Any reproduced critical caps the score at 49.

| Score | Band |
|---|---|
| 0–49 | Not ready |
| 50–74 | Risky |
| 75–89 | Almost there |
| 90+ | Ship it |

## Safety

- **Local targets only.** wreck-it refuses anything that isn't localhost or a private IP unless you pass `--i-own-this` (or set `iOwnThis`) for a target you own.
- **Load tests are GET/HEAD only** unless you set `allowMutatingLoad: true`. wreck-it warns when your database URL looks remote.
- **Report-only.** wreck-it never edits your code. Ask your agent to fix findings afterwards.
- A security-checks module is planned; v1 does not include it.

## Try it on the demo app

[`examples/buggy-app`](examples/buggy-app) is a small Next.js shop with seeded bugs. It doubles as the benchmark:

```bash
cd examples/buggy-app && npm install && npm run dev
# in your agent, from examples/buggy-app: "wreck my app"
node ../../scripts/eval.mjs --app .    # recall / false positives vs. the seeded-bug manifest
```

Release gate: ≥80% recall with ≤2 false positives, on Claude Code and at least one other agent. Latest: Claude Code + Sonnet found **22/23 bugs with 0 false positives** in about 17 minutes ([eval notes](docs/evals/2026-10-04-release-gate.md)). The second-agent run is pending.

**Models:** use a Sonnet- or Opus-class model (or an equivalent). Small models such as Haiku tend to skip stages; `wreck-it sweep` still gives them the mechanical coverage.

## Develop

```bash
npm install
npm test            # builds the CLI and runs vitest
npm run typecheck
npm run test:scripts
```

Design spec: [`docs/specs/2026-10-03-wreck-it-design.md`](docs/specs/2026-10-03-wreck-it-design.md).

## License

MIT
