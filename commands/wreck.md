---
description: Wreck your app before your users do. Run wreck-it (or one stage) against your local app.
argument-hint: "[stage: explore | chaos | load | a11y | trace | report] [notes]"
---

Use the **wreck-it** skill to test this project's locally running web app.

Arguments: `$ARGUMENTS`

- No arguments: run the full pipeline from the wreck-it skill.
- A first argument that names a stage: run only that stage's skill.
  - `explore` → wreck-explore
  - `chaos` → wreck-chaos
  - `load` → wreck-load
  - `a11y` → the accessibility section of wreck-chaos
  - `trace` → wreck-trace
  - `report` → `npx wreck-it report && npx wreck-it gen-tests`
  - Run preflight and discover first if `.wreck-it/discovery.json` is missing.
- Treat any other text as notes from the user (e.g. focus areas, a test account) and follow them.

Parallel personas: this plugin provides three isolated browsers (`wreck-browser-1`, `wreck-browser-2`, `wreck-browser-3`) and the `wreck-persona` subagent.
1. Run the normal-user pass yourself with `wreck-browser-1`.
2. Dispatch one `wreck-persona` subagent per remaining persona (except chaos-monkey), up to 3 at a time. Give each one:
   - the persona block from `.wreck-it/personas.md`
   - the base URL
   - its own browser number (1, 2 or 3), never shared
3. While subagents run, don't use any browser yourself. **Wait until all of them have reported back** before chaos, load or the reproduction sweep.
4. With more than 3 personas, dispatch the next one once a browser is free.

Report only: do not fix bugs unless the user asks after seeing the report.
