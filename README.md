# wreck-it

[![npm](https://img.shields.io/npm/v/@miyannishar/wreck-it?label=npm%20%40miyannishar%2Fwreck-it)](https://www.npmjs.com/package/@miyannishar/wreck-it)
[![license](https://img.shields.io/npm/l/@miyannishar/wreck-it)](LICENSE)

**Wreck your app before your users do.**

wreck-it turns your coding agent (Claude Code, Codex, Cursor, Gemini CLI, Copilot, …) into a QA team for your **locally running web app**. It tests the app the way real people break it:

- **Normal users** walking every core flow
- **Your ideal customers**, built from what your app actually does
- **Rushed beginners** on a phone, double-clicking and typing things in the wrong format
- **Chaos monkeys** feeding it hostile input, killing the network and tampering with sessions
- **Traffic spikes** and slow pages

Then it hands you a scored bug report that points at the code responsible, plus a regression test for every bug.

```
Readiness 41/100 (Not ready) → .wreck-it/report.html
Fix this first: WR-004 Double-clicking "Place order" creates two orders
                app/api/orders/route.ts:18 — no idempotency key; each POST inserts
```

Every finding comes with:

- **Repro steps and screenshots**, replayed in a fresh browser before the finding counts
- **The likely `file:line`** and *why* it causes the bug. When wreck-it can't pin a line, it lists candidate files instead of guessing.
- **A Playwright regression test** (`tests/wreck-it/WR-NNN.spec.ts`) that fails while the bug exists and passes once it's fixed

On top of that you get a deterministic **readiness score** (0–100) you can compare across runs and agents.

## Contents

- [What it finds](#what-it-finds)
- [How it works](#how-it-works)
- [Quickstart](#quickstart)
- [Installation](#installation)
- [Running it](#running-it)
- [Apps with a login](#apps-with-a-login)
- [Your data, money and inbox](#your-data-money-and-inbox)
- [The report](#the-report)
- [Readiness score](#readiness-score)
- [Regression tests](#regression-tests)
- [Configuration](#configuration)
- [CLI reference](#cli-reference)
- [Files wreck-it writes](#files-wreck-it-writes)
- [The demo app and benchmark](#the-demo-app-and-benchmark)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)
- [Developing wreck-it](#developing-wreck-it)

## What it finds

| Kind | Examples |
|---|---|
| **Broken flows** | Totals that ignore quantity, a coupon applied twice, edits that don't persist, a header badge that doesn't update after a delete |
| **Oddities** | `undefined` or `NaN` rendered on the page, broken images, dead links, raw ISO timestamps, a page that scrolls sideways on a phone |
| **UX problems** | Endless spinners on empty pages, "Something went wrong" errors that wipe the form, lists in the wrong order, missions a persona couldn't finish |
| **Chaos** | 500s on padded or negative input, double-submits creating duplicate orders, crashes when the network drops or an API call fails, state lost on back/refresh |
| **Accessibility** | axe-core violations on every page at desktop and mobile width, unlabeled inputs, low contrast, keyboard traps |
| **Performance** | Slow pages on a mid-range phone (Lighthouse LCP, CLS, TBT), N+1 queries, event-loop blocking, endpoints that fall over under load, memory leaks |

Security testing is planned but not part of v1.

## How it works

wreck-it has two halves:

| Part | Does |
|---|---|
| **Skills** (`skills/`) | The judgment: derive personas, drive the browser through Playwright MCP, decide what's a bug, trace it to code |
| **CLI** (`npx @miyannishar/wreck-it`) | Everything deterministic: setup, discovery, page sweeps, API fuzzing, Lighthouse, load tests, accessibility scans, finding storage, scoring, reports, test generation |

The CLI never calls an LLM and needs no API key. Your agent does the thinking; the CLI keeps results consistent so scores are comparable across runs and agents.

A full run goes through these stages:

| # | Stage | What happens |
|---|---|---|
| 1 | Setup and preflight | Checks tools, the app's address, the saved login, and what to ask you before writing data |
| 2 | Login | Signs in (or asks you to, once, for Google/GitHub/SSO) |
| 3 | Personas | Writes `.wreck-it/personas.md`: 2–3 ideal customers plus a normal user, a rushed beginner and a chaos monkey |
| 4 | Normal user | Every core flow, plus a 9-point data-integrity checklist (totals, persistence, deletes, sorting, empty states, error messages) |
| 5 | Personas | Each persona's missions, in character, in parallel in Claude Code |
| 6 | Chaos | Page sweep, API fuzzing, hostile inputs, double submits, navigation abuse, network faults, session tampering, keyboard-only |
| 7 | Page speed and load | Lighthouse on every page, then ramp, spike and soak load tests |
| 8 | Reproduce and trace | Every finding is replayed, then traced to `file:line` |
| 9 | Report | Score, HTML and Markdown report, regression tests |

Each stage also runs on its own: "just stress test my API", "only check accessibility", `/wreck chaos`.

## Quickstart

You need **Node.js 22.19 or newer** and your app running locally.

```bash
# 1. Start your app
npm run dev

# 2. Install the skills (or use the Claude Code plugin, below)
npx skills add miyannishar/wreck-it

# 3. Install the browsers and MCP servers wreck-it uses
npx @miyannishar/wreck-it setup --dry-run   # see what it will do
npx @miyannishar/wreck-it setup
```

Restart your agent so it loads the new MCP servers, then ask it:

> wreck my app

The report lands in `.wreck-it/report.html`. Add `.wreck-it/` to your `.gitignore`.

If you skip step 3, the agent offers to run it on the first run.

## Installation

### Claude Code (recommended)

```
/plugin marketplace add miyannishar/wreck-it
/plugin install wreck-it@wreck-it
```

Then run `/wreck`, `/wreck focus <feature>` for one feature, or one stage: `/wreck setup`, `/wreck login`, `/wreck explore`, `/wreck chaos`, `/wreck fuzz`, `/wreck perf`, `/wreck load`, `/wreck a11y`, `/wreck trace`, `/wreck report`. Anything after the stage is passed along as notes ("focus on checkout").

The plugin brings its own MCP servers, so there's nothing else to configure:

- `wreck-browser-1` and `wreck-browser-2`: desktop browsers
- `wreck-browser-3`: a phone (Pixel 7: 412 px wide, touch, mobile user agent)
- `wreck-devtools`: Chrome DevTools MCP, for performance traces and slow-network tests

Personas run as up to three parallel subagents, each in its own browser. The first time, the agent may run `setup` once to download the browser these servers use.

### Codex, Gemini CLI, Cursor, VS Code / Copilot

```bash
npx skills add miyannishar/wreck-it
npx @miyannishar/wreck-it setup
```

`setup` finds the agents on your machine and adds Playwright MCP and Chrome DevTools MCP to each:

| Agent | How |
|---|---|
| Claude Code | `claude mcp add …` |
| Codex | `codex mcp add …` |
| Gemini CLI | `.gemini/settings.json` in the project |
| Cursor | `.cursor/mcp.json` in the project |
| VS Code / Copilot | `.vscode/mcp.json` in the project |

It only adds entries, never edits or removes yours. Limit it with `--agent codex` or skip parts with `--skip schemathesis`.

### Any other agent

Paste [`AGENTS.md.snippet`](AGENTS.md.snippet) into your `AGENTS.md` (or `CLAUDE.md`, `GEMINI.md`, `.cursor/rules`), and add these two stdio MCP servers by hand:

```
npx @playwright/mcp@0.0.83 --browser chromium --isolated --caps network,storage,testing,devtools
npx chrome-devtools-mcp@1.10.1 --headless=true --isolated=true --performanceCrux=false --usageStatistics=false
```

Then run `npx @playwright/mcp@0.0.83 install-browser chromium` once.

### The CLI on npm

The CLI is published as [`@miyannishar/wreck-it`](https://www.npmjs.com/package/@miyannishar/wreck-it). You don't need to install it: the skills and the plugin call it with `npx`, which fetches the latest version on first use. To pin a version or run it in CI, add it to a project:

```bash
npm i -D @miyannishar/wreck-it
npx wreck-it --version
```

### What gets installed

| Tool | Used for | Installed by |
|---|---|---|
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | Driving the browser as each persona: clicks, forms, fake API responses, offline mode, cookie and storage tampering, traces | `setup` (bundled in the plugin) |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Performance traces, slow-network and slow-CPU emulation (optional; needs Google Chrome) | `setup` (bundled in the plugin) |
| [Lighthouse](https://github.com/GoogleChrome/lighthouse) | Page speed | npm dependency of the CLI |
| [axe-core](https://github.com/dequelabs/axe-core) | Accessibility scans | npm dependency |
| [autocannon](https://github.com/mcollina/autocannon) | Load tests | npm dependency |
| [Schemathesis](https://schemathesis.io) | Extra API fuzzing for apps with an OpenAPI spec | `setup`, through [uv](https://docs.astral.sh/uv/) |
| Chromium | Scans, Lighthouse, persona browsers | downloaded automatically on first use, or by `setup` |

Playwright MCP is pinned to a fixed version so the browser it expects doesn't change under you. Chrome DevTools MCP runs with Google's usage statistics and CrUX lookups turned off.

## Running it

Ask your agent in plain language:

| You say | It runs |
|---|---|
| "wreck my app", "is my app ready to ship?" | The full pipeline |
| "click through my app like a user", "test the happy paths" | Normal user and personas |
| "break my forms", "try weird inputs", "test offline" | Chaos |
| "stress test my API", "check page speed", "run Lighthouse" | Page speed and load |
| "check accessibility" | Accessibility sweep and keyboard checks |
| "test the checkout", "just test signup" | A focused run on that one feature |

A full run on a small app takes roughly 15–30 minutes with a Sonnet- or Opus-class model. Small models (Haiku-class) tend to skip stages; `wreck-it sweep` still gives them the mechanical coverage.

**Just one feature?** Say "test the checkout", "just test signup", or `/wreck focus checkout`. The agent finds that feature's pages and API routes, walks it as a normal user and a rushed beginner, runs `sweep`, `fuzz`, chaos and page speed on that scope only, and writes a report labelled as a focused run, in a few minutes instead of a full run.

**No browser tools?** If Playwright MCP isn't available and you don't want to set it up, the agent does a **CLI-only run**: `sweep`, `fuzz`, `perf`, `load` and the report. It marks the browser stages as skipped instead of pretending.

**Report only.** wreck-it never edits your code. At the end, the agent offers to fix the top findings and waits for your yes.

## Apps with a login

### Google, GitHub, SSO, magic links, 2FA

Agents can't (and shouldn't) type a Google password, so wreck-it uses the standard approach: you log in once and every later step reuses the session.

```bash
npx @miyannishar/wreck-it login                  # a browser window opens
npx @miyannishar/wreck-it login --label second   # optional: a second user, for "B can't see A's data" checks
npx @miyannishar/wreck-it login --check          # is the saved session still valid?
```

1. A window opens at your app's login page. It uses your real Chrome when installed, which Google is less likely to block.
2. You sign in however your app works.
3. wreck-it notices you're logged in: in the background, without touching the window, it asks your app's server whether the session now opens a page that logged-out visitors can't. It then saves the session and closes the window. For apps that check login only in the browser, it finishes once the window has been back on your app for a few seconds. Closing the window yourself also works.
4. Only **your app's** cookies and local storage are saved, to `.wreck-it/auth/<label>.json` (owner-readable only). The sign-in provider's cookies are left out. The account is added to `.wreck-it/config.json`.

From then on, `sweep`, `fuzz` and `perf` load the session, the persona browsers load it, and generated tests start from it. No password ever ends up in a finding or a test.

`discover` recognizes Google, GitHub, Apple, Microsoft and Discord providers, hosted sign-in (Clerk, Auth0, Kinde, WorkOS, Stytch) and email links, so the agent knows to ask you up front. Preflight tells you when the session has expired. If wreck-it can't find a page that requires login to check against, set `"authCheck": "/dashboard"` in the config.

Use a **test** account, not your personal one: the agents act as that user.

### Email and password

Put a test account in the config:

```json
{ "accounts": [{ "label": "main", "email": "tester@example.com", "password": "…" }] }
```

The first command that logs in fills the form (one-step or two-step) and saves the session, so generated tests don't need the password either.

### Keeping the login alive

- The agents never log out, delete or change the password of the account whose session other stages use. On Supabase and many other apps, logging out ends **every** session of that user. Logout and account-deletion checks use a throwaway account, last.
- `sweep` and `fuzz` write refreshed sessions back to the file, because apps like Supabase rotate refresh tokens. They never overwrite a good session with a logged-out one.

## Your data, money and inbox

Most apps built with AI tools run locally but talk to a **hosted database**: Supabase, Firebase, Neon. Often it's the only one, which means production. They also call paid APIs and send real email. wreck-it checks for all of this before it writes anything.

**Before any stage that writes data**, preflight lists questions for you, and the agent asks them in one message:

| Situation | What wreck-it does |
|---|---|
| Hosted database (from `.env`, or a Supabase URL hardcoded in source, Lovable-style) | Asks whether it's a dev project or production. Writing stages wait until you agree (`"allowRemoteDb": true`). |
| Live Stripe keys (`sk_live_…`) | Never completes a payment. With test keys it uses Stripe's test card. |
| Endpoints that call AI models, send SMS or email, or take payments | `fuzz` and `load` skip them; the browser triggers them only 2–3 times. You can allow more with `"allowSideEffects": ["ai"]`. |
| The app sends email and there's no local inbox | Asks for an address you can read (`"testEmail": "me+wreck{n}@gmail.com"`). |
| A CAPTCHA | Reports flows behind it as blocked, not as bugs. Use test keys locally to test them. |

`discover` finds these side effects per endpoint, including calls made through helper files and plain `fetch` calls to APIs like `api.openai.com`.

**Email.** Sign-ups use addresses from `wreck-it email new`, never `example.com`: those bounce, and Supabase, Resend and SendGrid throttle senders with many bounces. With a local test inbox (Mailpit, or Supabase's local stack) the agent reads confirmation links itself with `wreck-it email read`. Otherwise it asks you for the link, or marks the check as skipped.

**Cleanup.** Everything the agents create is named `wreck-it …` and logged with `wreck-it run created`. `fuzz` logs its own writes. The report lists it all under **Test data created**.

**Local only.** The CLI refuses any target that isn't localhost or a private address, unless you pass `--i-own-this` for a server you own. Load tests send GET/HEAD only unless you set `"allowMutatingLoad": true` yourself. `fuzz` never sends DELETE unless you pass `--include-delete`.

## The report

`wreck-it report` writes `.wreck-it/report.html` (self-contained, open it in a browser) and `.wreck-it/report.md` (for PRs and issues). It contains:

- the readiness score, its band, and a score per category
- **Fix this first**: the most severe confirmed finding, with its `file:line`
- every confirmed finding, by severity, each with:
  - the steps to reproduce
  - expected vs. actual behavior
  - the traced source (`file:line`, snippet, why, confidence)
  - screenshots, console errors and failing requests
  - a replayable Playwright trace for serious findings (`npx playwright show-trace …`)
  - the path to its regression test
- load-test charts (p50/p99 latency and error rate per phase, with the breaking point) and the memory trend
- coverage: stages run, personas used, routes visited and not visited
- unconfirmed (flaky) findings, which don't count toward the score
- test data created, for cleanup

## Readiness score

The score starts at 100. Each **reproduced** finding takes off points by severity:

| Severity | Points |
|---|---|
| critical | −25 |
| high | −10 |
| medium | −4 |
| low | −1 |

Each category's total deduction is capped, so one noisy category can't sink the score alone:

| Category | Cap |
|---|---|
| functional | 60 |
| security | 50 |
| performance | 40 |
| chaos | 30 |
| ux | 20 |
| oddity | 15 |
| accessibility | 15 |

Any reproduced critical finding caps the score at 49.

| Score | Band |
|---|---|
| 0–49 | Not ready |
| 50–74 | Risky |
| 75–89 | Almost there |
| 90+ | Ship it |

Findings that couldn't be reproduced score nothing; they're listed as unconfirmed.

## Regression tests

`wreck-it gen-tests` writes one Playwright spec per reproduced finding to `tests/wreck-it/`. It also adds a `playwright.config.ts` if you don't have one.

```bash
npm i -D @playwright/test
npx playwright test tests/wreck-it
```

Each test replays the finding's steps and asserts the **correct** behavior, so it fails while the bug exists and passes once you've fixed it. Findings without a checkable assertion are generated as `test.fixme`. Performance findings don't get tests.

| Variable | Overrides |
|---|---|
| `WRECK_IT_BASE_URL` | The app's address (default: the `baseUrl` from the config) |
| `WRECK_IT_AUTH_<LABEL>` | The saved session file for an account, e.g. `WRECK_IT_AUTH_MAIN=/secrets/main.json` in CI |

Sign-up tests use a fresh email on every run, so they can run again and again.

## Configuration

`.wreck-it/config.json`. Every field is optional:

```json
{
  "baseUrl": "http://localhost:3000",
  "accounts": [
    { "label": "main", "storageState": ".wreck-it/auth/main.json" },
    { "label": "B", "email": "b@example.com", "password": "…" }
  ],
  "authCheck": "/dashboard",
  "allowRemoteDb": false,
  "allowSideEffects": [],
  "testEmail": "me+wreck{n}@gmail.com",
  "inboxUrl": "http://127.0.0.1:8025",
  "allowMutatingLoad": false,
  "iOwnThis": false,
  "exclude": ["/admin"],
  "thresholds": { "p99Ms": 2000, "errorRate": 0.01 }
}
```

| Field | Meaning |
|---|---|
| `baseUrl` | Where the app runs. Default: guessed by `discover` from the framework and dev script, else `http://localhost:3000` |
| `accounts` | Test accounts: `email` + `password`, or a `storageState` file from `wreck-it login`. The first one is used unless a command gets `--account <label>` |
| `authCheck` | A page only logged-in users can see, used to check saved sessions |
| `allowRemoteDb` | You agreed that testing may write to the hosted database |
| `allowSideEffects` | Side effects you allow in bulk: any of `"ai"`, `"sms"`, `"email"`, `"payments"` |
| `testEmail` | An address you can read, with `{n}` for a per-use number |
| `inboxUrl` | A local test inbox (Mailpit or Inbucket). Default: probes `:8025`, `:54324`, `:9000` |
| `allowMutatingLoad` | Allow POST/PUT/PATCH/DELETE load tests |
| `iOwnThis` | Allow a non-local target you own |
| `exclude` | Routes never to visit (prefix match) |
| `thresholds` | Load-test limits: p99 latency in ms, and error rate |

`npx @miyannishar/wreck-it schema config` prints the full JSON Schema.

## CLI reference

All commands take `--root <dir>` (the project folder, default: the current directory), and most take `--json`. Commands that touch the app take `--i-own-this` for a non-local target you own.

### Setup and login

| Command | What it does |
|---|---|
| `setup [--dry-run] [--agent <name…>] [--skip <id…>]` | Installs Chromium, the Playwright MCP browser, Google Chrome (for DevTools MCP), Playwright MCP and Chrome DevTools MCP for each agent, and Schemathesis via uv. `--dry-run` only reports what's ready and what's missing. Step ids for `--skip`: `chromium`, `mcp-browser`, `chrome`, `playwright-mcp`, `devtools-mcp`, `schemathesis`. |
| `login [--label <name>] [--url <path>] [--timeout <sec>] [--check]` | Opens a browser so you can sign in, then saves the app's session. `--check` only tests the saved session. |
| `email new` | Prints a fresh sign-up address (from `testEmail`, or any address when a local inbox runs). |
| `email read --to <address> [--wait <sec>]` | Waits for the newest mail to that address in the local inbox and prints its links, confirmation links first. |

### Discovery and checks

| Command | What it does |
|---|---|
| `discover` | Static scan (no network): framework, pages, API routes, forms, login method, database (local or hosted), paid side effects per endpoint, Stripe key mode, CAPTCHAs, email confirmation. Writes `.wreck-it/discovery.json`. |
| `preflight [--url <url>] [--wait <sec>]` | Is the target allowed and reachable, is Playwright MCP configured, is the saved session valid, and what must the agent ask before writing. Exit 3: target refused; exit 4: not reachable. |

### Testing

| Command | What it does |
|---|---|
| `sweep [--record] [--only <route…>] [--viewports 1280x800,390x844] [--no-a11y] [--account <label>]` | Visits every discovered page at each viewport, logged in when an account is configured. Fills dynamic routes from real links and skips logout links. Runs the oddity script and axe-core. `--record` files one reproduced finding per root cause. `--only` limits it to those routes and the ones below them. |
| `fuzz [--record] [--only <route…>] [--seed <json>] [--max-requests <n>] [--include-delete] [--include-side-effects] [--schemathesis auto\|always\|never] [--allow-remote-db] [--account <label>]` | Sends bad values to every write endpoint, one field at a time: negative, zero, huge and fractional numbers; text for numbers; empty, padded, 5,000-character, `%`, quote and emoji strings; `null`; missing fields; invalid JSON. Reads each handler's fields from source and fills ids from real list endpoints. Seeds also come from `.wreck-it/requests.json`. Records server errors and lists accepted-but-suspicious values. Runs Schemathesis when there's an OpenAPI spec. `--only` limits it to those API routes. |
| `perf [url…] [--record] [--device mobile\|desktop] [--max-pages <n>] [--account <label>]` | Lighthouse on each page (default: a mid-range phone on slow 4G). Reports score, LCP, CLS and TBT. `--record` files metrics in Google's "poor" range (LCP > 4 s, CLS > 0.25, TBT > 600 ms) when a second run agrees. On a dev server only CLS is recorded. |
| `load <url> [--profile ramp\|spike\|soak] [--method GET] [--header k:v] [--pid <n>] [--max-connections <n>] [--step-duration <s>] [--soak-duration <s>] [--include-side-effects]` | autocannon load test. **ramp**: 10 → 500 connections until the thresholds break. **spike**: 10 → 100 → 10. **soak**: steady load with memory sampling (default 180 s). Records server crashes itself. |
| `a11y <url…> [--record] [--viewport WxH] [--storage-state <file>]` | axe-core scan of specific pages. |
| `oddity-script` | Prints a browser function for Playwright MCP's `browser_evaluate`. It flags rendered `undefined`/`NaN`/`null`, broken images, dead links, horizontal overflow, overlapping elements, slow LCP and empty pages. |

### Findings, runs and output

| Command | What it does |
|---|---|
| `finding add [json] [--file <path>]` | Validates and saves a finding (from an argument, a file or stdin). Prints its id. |
| `finding update <id> [json] [--file <path>]` | Patches a finding, e.g. `'{"reproduced":true}'`. |
| `finding list [--json]` | Lists findings. `?` marks unreproduced ones. |
| `run init [--fresh] [--focus <feature>]` | Starts a run. `--fresh` deletes the previous findings, screenshots, load data and reports. `--focus` marks a one-feature run, so the report scores only that feature. |
| `run stage <stage> <running\|done\|skipped\|failed>` | Records progress. Stages: `preflight`, `discover`, `personas`, `normal`, `explore`, `chaos`, `load`, `security`, `trace`, `report`. |
| `run visit <route> --persona <name>` | Records coverage. |
| `run created "<what>" --by <persona>` | Logs test data created in the app, for the report's cleanup list. |
| `run show` | Prints run state and visits. |
| `report` | Writes `report.html` and `report.md`, and prints the score. |
| `gen-tests` | Writes `tests/wreck-it/WR-NNN.spec.ts`. |
| `schema finding\|config` | Prints a JSON Schema. |

## Files wreck-it writes

```
.wreck-it/
  config.json         your settings
  discovery.json      what discover found
  personas.md         the personas (edit it; it's reused next run)
  auth/<label>.json   saved logins (live sessions: keep out of git)
  findings/WR-NNN.json
  shots/              screenshots and browser traces
  perf/               Lighthouse reports and summaries
  fuzz/               fuzz results and Schemathesis output
  load/               load-test results
  a11y/               axe results
  requests.json       real requests saved to seed fuzz
  created.jsonl       test data created in the app
  run.json, visits.jsonl, sweep.json, normal-pass.md, chaos-log.md
  report.html, report.md
tests/wreck-it/       generated regression tests
```

Add `.wreck-it/` to `.gitignore`. Commit `tests/wreck-it/` if you want the regression tests in CI.

## The demo app and benchmark

[`examples/buggy-app`](examples/buggy-app) is a small Next.js shop with **23 seeded bugs** across every category: functional, UX, oddity, chaos, performance and accessibility. It's both the demo and the benchmark.

```bash
cd examples/buggy-app && npm install && npm run dev   # demo login: demo@gadgetly.test / gadgetly123
# in your agent, from examples/buggy-app: "wreck my app"
node ../../scripts/eval.mjs --app .    # recall and false positives vs. the seeded-bug manifest
```

The release gate is ≥ 80% recall with ≤ 2 false positives. On 2026-10-04, Claude Code with Sonnet found **22 of 23 bugs with 0 false positives** in about 17 minutes ([eval notes](docs/evals/2026-10-04-release-gate.md)). That run predates the login and data-safety features; a second-agent run is pending.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Playwright MCP not found" | `npx @miyannishar/wreck-it setup`, then restart your agent |
| A browser tool says "Browser … is not installed" | `npx @miyannishar/wreck-it setup --skip playwright-mcp devtools-mcp` |
| Preflight exit 4 (not reachable) | Start the app, check `baseUrl` (the port!), then `preflight --wait 60` |
| Preflight exit 3 (refused) | The target isn't local. Use your local dev server, or `--i-own-this` for a server you own |
| Google says "This browser or app may not be secure" | Install Google Chrome (`login` uses it when present) and try again |
| `login` reports `check: unknown` | Set `"authCheck"` to a page that requires login |
| Session `expired` | Run `npx @miyannishar/wreck-it login` again |
| `fuzz` refuses: database is remote | Confirm it's not production, then set `"allowRemoteDb": true` |
| `perf` numbers look terrible | You're on a dev server. Run a production build (`npm run build && npm start`) and measure again |
| "Lighthouse could not be loaded" | Upgrade to Node 22.19+ |
| Generated tests fail with a login page | Run `login` again, or point `WRECK_IT_AUTH_<LABEL>` at a valid session file |

## Limitations

- **Frameworks:** route discovery understands Next.js (app and pages router), Express, Fastify, Hono, React Router, SvelteKit and Remix. For anything else, the agent crawls from the home page.
- **Apps without server API routes** (e.g. Vite apps that talk to Supabase directly) give `fuzz` nothing to test. Testing their database rules belongs to the planned security module.
- **One `baseUrl`:** a separate frontend and API on different ports aren't handled yet.
- **Sessions checked in the browser only** (no server redirect): `login --check` reports `unknown`.
- **Services that don't run locally** (Stripe webhooks without `stripe listen`, background jobs, cron) can make flows look broken. The agent should say so rather than blame the app, but double-check those findings.
- **Windows** isn't tested yet.
- **Security testing** is not in v1.

## Developing wreck-it

```
packages/cli/        the CLI (TypeScript)
skills/              the agent skills (wreck-it, explore, personas, chaos, load, trace)
commands/wreck.md    the /wreck command for Claude Code
agents/              the parallel persona subagent
.claude-plugin/      the Claude Code plugin manifest
.mcp.json            the plugin's MCP servers
examples/buggy-app/  the demo app and benchmark
scripts/eval.mjs     the benchmark scorer
AGENTS.md.snippet    the procedure for agents without skill support
```

```bash
npm install
npm test               # builds the CLI and runs the vitest suite
npm run typecheck
npm run test:scripts   # tests for the eval script
```

Design spec: [`docs/specs/2026-10-03-wreck-it-design.md`](docs/specs/2026-10-03-wreck-it-design.md).

## License

MIT
