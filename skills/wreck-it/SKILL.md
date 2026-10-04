---
name: wreck-it
description: Full wreck-it run against a locally running web app. It tests like normal users, ICP personas, rushed beginners, chaos monkeys and traffic spikes, then writes a scored bug report with source file:line and regression Playwright tests. Use when the user says "wreck my app", "wreck it", "test my app like a user", "find bugs before launch", "is my app ready to ship", or asks for a readiness score. For a single stage ("just stress test my API", "only check accessibility"), use the matching wreck-* skill.
---

# wreck-it: Wreck your app before your users do

You are running the full wreck-it pipeline. The `wreck-it` CLI (`npx wreck-it …`) is deterministic: it handles discovery, finding storage, scoring, reports, load testing, accessibility scans and test generation. You supply the judgment: you drive the browser through Playwright MCP, act as personas, decide what counts as a bug, and trace bugs to code.

Report only. **Do not fix bugs** during a run, even obvious ones, unless the user asks after the report.

## Safety rules (always)

- Test only the user's **local** app (localhost or a private IP). The CLI refuses other targets. Pass `--i-own-this` only when the user explicitly says they own a remote target.
- Load tests are GET/HEAD only unless `.wreck-it/config.json` has `"allowMutatingLoad": true`.
- Use test accounts and fake data. Never enter real personal or payment data.
- If the app's database looks remote (preflight or discover warns), tell the user before any stage that writes data, and ask whether to continue.

## Pipeline

Mark each stage with `npx wreck-it run stage <stage> running|done|skipped|failed`. Findings are saved as you go, so a failure mid-run still leaves a usable partial report.

### 1. Preflight
```bash
npx wreck-it run init           # add --fresh to discard a previous run's findings
npx wreck-it discover           # also needed for preflight's dev-script hint
npx wreck-it preflight --wait 5
```
- **Exit 4, app not reachable:** offer to start it with the reported `devScript` (run it in the background), then `npx wreck-it preflight --wait 60`.
- **Exit 3, target refused:** stop and explain. Never work around it.
- **`playwrightMcp.found` is false:** check whether browser tools are actually available to you (e.g. `browser_navigate`). If they are not, print the matching `installHints` entry for this agent, ask the user to install it, and stop. Do not silently skip browser stages.
- If `.wreck-it/config.json` is missing, create it with the base URL: `{"baseUrl": "http://localhost:3000"}`.
- Once you have a working test account (the user's, or one you sign up in stage 4), add it to config as `"accounts": [{"label": "main", "email": "…", "password": "…"}]`. `wreck-it sweep` uses it to cover logged-in pages.

### 2. Discover
`npx wreck-it discover` writes `.wreck-it/discovery.json` with pages, API routes, forms, auth and database. If `frameworks` is empty, crawl from the home page instead: follow nav links two levels deep and note the routes.

### 3. Personas
Use the **wreck-personas** skill. It reuses `.wreck-it/personas.md` if that file already exists.

### 4. Normal-user pass, then 5. persona exploration
Use the **wreck-explore** skill: first the `normal-user` pass, then each remaining persona's missions.
- **Claude Code with the wreck-it plugin:** run up to 3 personas in parallel, each as a `wreck-persona` subagent with its own browser (`wreck-browser-1..3`). Each browser is used by exactly one subagent.
  - **Wait for every subagent to finish** before you start stage 6.
  - Don't use any browser yourself while subagents are running.
- **Other agents:** run them one after another.

### 6. Chaos
Use the **wreck-chaos** skill. It starts with `npx wreck-it sweep --record` (every page × 2 viewports: oddities and axe), then covers hostile inputs, double submits, navigation abuse, network faults and keyboard accessibility.

### 7. Load
Use the **wreck-load** skill.

### 8. Security
Not part of v1. Run `npx wreck-it run stage security skipped`.

### 8½. Reproduction sweep
Run `npx wreck-it finding list`. For every finding marked `?` (not reproduced), replay its steps now in a fresh context and set `reproduced: true` if it shows again. Unreproduced findings score nothing, so a real bug left at `?` is a missed bug.

### 9. Trace
Use the **wreck-trace** skill for every reproduced finding that has no `source`.

### 10. Report
```bash
npx wreck-it report
npx wreck-it gen-tests
npx wreck-it run stage report done
```

## Recording findings

Follow `references/recording-findings.md` (in this skill's directory) exactly. Core rules:
- Record with `npx wreck-it finding add`.
- Steps are structured, targets are role/label locators, and assertions describe the correct behavior.
- A finding counts only after you replay it in a fresh context and set `reproduced: true`.

## Oddity detector (passive, on every page in stages 4–6)

Get the script once with `npx wreck-it oddity-script`. After each navigation, pass it as the `function` argument of `browser_evaluate`. It returns `{url, signals[]}`.

Also check:
- `browser_console_messages` for errors
- `browser_network_requests` for 4xx/5xx responses
- the page itself for problems a script can't judge: weird layout, title/content mismatch, empty states with no guidance, spinners that never resolve, buttons that do nothing, mismatched date or currency formats

Record each real oddity as category `oddity`, usually low or medium.

Track coverage with `npx wreck-it run visit <route> --persona <name>` for every route you exercise.

## Final message to the user

Keep it short:
- the readiness score and band
- the "fix this first" finding with its `file:line`
- counts by severity
- incomplete stages, if any
- paths to `.wreck-it/report.html`, `.wreck-it/report.md` and `tests/wreck-it/`
- how to run the generated tests: `npx playwright test tests/wreck-it`

Offer to fix the top findings. Don't start fixing until they say yes.
