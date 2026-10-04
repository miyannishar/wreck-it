---
description: Wreck your app before your users do. Run wreck-it (or one stage) against your local app.
argument-hint: "[stage: setup | login | explore | chaos | fuzz | perf | load | a11y | trace | report] [notes]"
---

`WRECK` means `npx @miyannishar/wreck-it`.

Use the **wreck-it** skill to test this project's locally running web app.

Arguments: `$ARGUMENTS`

- No arguments: run the full pipeline from the wreck-it skill.
- A first argument that names a stage: run only that stage's skill.
  - `login` → tell the user a browser window will open for them to sign in, then run `WRECK login` (add `--label <name>` if they named an account)
  - `setup` → `WRECK setup --dry-run`, show it, and run `WRECK setup` if the user agrees
  - `explore` → wreck-explore
  - `chaos` → wreck-chaos
  - `fuzz` → the API fuzz section of wreck-chaos (`WRECK fuzz --record`)
  - `perf` → the page-speed section of wreck-load (`WRECK perf --record`)
  - `load` → wreck-load
  - `a11y` → the accessibility section of wreck-chaos
  - `trace` → wreck-trace
  - `report` → `WRECK report && WRECK gen-tests`
  - Run preflight and discover first if `.wreck-it/discovery.json` is missing.
- Treat any other text as notes from the user (e.g. focus areas, a test account) and follow them.

Browsers: this plugin provides three isolated Playwright browsers and one Chrome DevTools browser:
- `wreck-browser-1` and `wreck-browser-2`: desktop
- `wreck-browser-3`: a phone (Pixel 7: 412 px wide, touch, mobile user agent)
- `wreck-devtools`: Chrome DevTools MCP, for performance traces and network/CPU throttling (wreck-load, slow-network chaos)

All three Playwright browsers have network mocking, offline mode, cookie/storage tools and tracing enabled.

Parallel personas use the `wreck-persona` subagent.
1. Run the normal-user pass yourself with `wreck-browser-1`.
2. Dispatch one `wreck-persona` subagent per remaining persona (except chaos-monkey), up to 3 at a time. Give each one:
   - the persona block from `.wreck-it/personas.md`
   - the base URL
   - the account label to use (from `.wreck-it/config.json`); with a saved session, the persona loads it instead of logging in
   - its own browser number (1, 2 or 3), never shared. Give a phone persona browser 3 and desktop personas browsers 1–2. A second phone persona waits for browser 3, or uses browser 1–2 with `browser_resize` if waiting would stall the run.
3. While subagents run, don't use any browser yourself. **Wait until all of them have reported back** before chaos, load or the reproduction sweep.
4. With more than 3 personas, dispatch the next one once a browser is free.

Report only: do not fix bugs unless the user asks after seeing the report.
