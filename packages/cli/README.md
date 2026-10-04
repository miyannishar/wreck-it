# wreck-it (CLI)

**Wreck your app before your users do.**

This is the deterministic half of [wreck-it](https://github.com/miyannishar/wreck-it): discovery, finding storage, oddity detector, axe-core scans, autocannon load tests, the readiness score, HTML/Markdown reports and Playwright regression tests. Your coding agent drives it through the wreck-it skills. See the main README for setup.

```bash
npx wreck-it discover
npx wreck-it preflight --wait 30
npx wreck-it finding add --file finding.json
npx wreck-it a11y http://localhost:3000/ --record
npx wreck-it load http://localhost:3000/api/products --profile ramp
npx wreck-it report && npx wreck-it gen-tests
```

The CLI never calls an LLM, needs no API key, and refuses non-local targets unless you pass `--i-own-this`. Requires Node ≥ 20. `a11y` needs Chromium: `npx playwright install chromium`.

MIT
