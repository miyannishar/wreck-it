# TODO

State as of 2026-10-04:
- **v1 is built.** Spec milestones 1–4 and 6 are done; 5, security, is deferred (below).
- **The release gate is met on Claude Code + Sonnet:** 22/23 recall, 0 false positives (`docs/evals/2026-10-04-release-gate.md`).
- **Nothing is committed yet.**

## Release blockers

- [ ] **Second-agent eval.** Spec §11 requires the gate on Claude Code **and** one other agent. Codex #1 scored 74% on the older skills, then the workspace ran out of credits.
  - Refill the Codex credits and rerun, or run Gemini CLI, on the current skills.
  - Record the result in `docs/evals/2026-10-04-release-gate.md`.
  - The harness pattern is in that doc.
- [ ] **Re-confirm the gate on the latest skills.** These changed after the passing Sonnet run (generated-test settle waits, `httpStatus.atLeast`, `{{unique}}`, assertion-quality guidance).
  - Run one more Sonnet eval to confirm recall still holds.
  - Measure the generated-test false-pass rate. It was 5 of 32 specs passing while their bug existed.
- [ ] **Commit and push** to `github.com/miyannishar/wreck-it`. The repo must be public for `npx skills add` and the plugin marketplace.
- [ ] **Smoke-test the install paths** once the repo is public:
  - `npx skills add miyannishar/wreck-it`
  - `/plugin marketplace add miyannishar/wreck-it` then `/plugin install wreck-it@wreck-it`
  - `npx wreck-it --version` from a clean machine
- [ ] **Publish to npm.**
  - Re-check the name first with `npm view wreck-it`. Fallbacks are `wreckit` and `@wreck-it/cli`; if one is needed, update the READMEs, skills and snippet.
  - Then `npm publish` from `packages/cli` (requires `npm run build`). Note that the `files` list ships only `dist`.
- [ ] **Measure the spec success criterion:** "install-to-report in under 5 minutes on a fresh Next.js app".

## Launch

- [ ] Assets in `.marketing/assets.md`:
  - demo GIF and video
  - report, load-chart and generated-test screenshots
  - logo and OG image
  - readiness badge
- [ ] Listings in `.marketing/listings.md`. Manifests still to create:
  - Cursor plugin manifest
  - `.codex-plugin/plugin.json`
  - `gemini-extension.json`
  - Copilot plugin bundle

  The Claude Code plugin and `skills/` already exist.
- [ ] Add a per-agent results table to the README once the second-agent eval is done.

## Quality follow-ups (post-v1 is fine)

- [ ] **Weak generated tests.** Agents sometimes write assertions that pass while the bug exists.
  - Idea: `wreck-it verify-tests` runs `tests/wreck-it/` against the current (buggy) app and flags specs that pass.
  - The agent then fixes those assertions or downgrades them to `fixme`.
- [ ] **Small models (Haiku-class) score 13–30%.** They skip judgment stages.
  - Move more mechanical work into the CLI. Example: `wreck-it load --auto` would pick GET endpoints from discovery, run ramp/soak, and record threshold findings itself.
  - Or document a minimum model class (the README currently recommends Sonnet/Opus-class).
- [ ] **Network-fault chaos is usually skipped.** Playwright MCP exposes no offline or route-mocking tool, so agents skip chaos §4.
  - Consider a CLI helper that replays a recorded flow with offline/slow/500 faults via the `playwright` package.
- [ ] **Keyboard-only accessibility checks are usually skipped.** Consider a scripted tab-order and focus-visibility check inside `sweep`.
- [ ] **Duplicate findings.** Sonnet #2 filed 10 duplicates of 22 bugs.
  - Consider `wreck-it finding list --similar <text>` or a similarity warning on `finding add`.
- [ ] **`sweep` runs axe only at the first viewport.** Consider a mobile a11y pass, mainly for target-size rules.
- [ ] **`discover` adapters are only tested on fixtures.** Run them against one real open-source project per framework (Next.js, Express, Fastify, Hono, React Router, SvelteKit, Remix).
- [ ] **Load memory sampling is unverified on Windows.** It uses `ps`/`lsof`, so on Windows it degrades to "not sampled".
- [ ] **The eval's B12 (empty cart without guidance)** was missed by every run. Check whether the normal-pass checklist row 7 wording needs to name the cart explicitly. Don't tune skills to the benchmark beyond generic advice.

## Deferred

- [ ] **Security checks module (deferred from v1).** Design a security-checking stage for wreck-it.
  - The first approach was dropped during planning. One direction to explore is integrating established, well-known scanners and collecting their results into the wreck-it report.
  - Needs its own brainstorm → spec → plan cycle.
  - The `security` category stays in the finding schema and readiness score so findings can slot in later.
