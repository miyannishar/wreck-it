# Gadgetly: the wreck-it buggy app

A small Next.js 16 shop with **23 seeded bugs** (no security bugs; that module is deferred). It's the wreck-it demo and its eval benchmark. All data is in memory and resets when the server restarts. There's no database and no external services.

## Run

```bash
npm install
npm run dev            # http://localhost:3000
# or a production build, which gives more realistic load numbers:
npm run build && npm start
```

Demo account: `demo@gadgetly.test` / `gadgetly123`. You can also sign up a new account. Coupons: `SAVE10` and `WELCOME5`.

## Wreck it

From this directory, ask your agent "wreck my app", or run `/wreck` in Claude Code with the wreck-it plugin.

> **Evaluating an agent?** Do not let it read `wreck-manifest.json`. That file is the answer key. Run the agent from a fresh session, and if you can, keep the manifest outside the agent's view.

## Score the run

```bash
node ../../scripts/eval.mjs --app .          # or from the repo root: npm run eval
node ../../scripts/eval.mjs --app . --json
```

The eval matches each **reproduced** finding to at most one seeded bug. A finding matches a bug when the route matches and either the traced source file matches or a keyword appears in the finding's text.
- Extra findings for an already-matched bug count as duplicates, not false positives.
- Unreproduced findings are ignored.

It prints recall, false positives and PASS/FAIL against the release gate: **≥80% recall, ≤2 false positives**. The exit code is 0 on PASS.

Bug categories: functional (4), ux (5), oddity (4), chaos (4), performance (3), accessibility (3).
