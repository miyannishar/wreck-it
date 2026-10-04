# wreck-it (CLI)

**Wreck your app before your users do.**

This is the deterministic half of [wreck-it](https://github.com/miyannishar/wreck-it): setup, discovery, finding storage, oddity detector, axe-core scans, API fuzzing (plus Schemathesis), Lighthouse page speed, autocannon load tests, the readiness score, HTML/Markdown reports and Playwright regression tests. Your coding agent drives it through the wreck-it skills. See the main README for setup.

```bash
npx @miyannishar/wreck-it setup                     # browsers, Playwright MCP + Chrome DevTools MCP for your agents, Schemathesis
npx @miyannishar/wreck-it discover
npx @miyannishar/wreck-it preflight --wait 30
npx @miyannishar/wreck-it sweep --record
npx @miyannishar/wreck-it fuzz --record
npx @miyannishar/wreck-it perf --record
npx @miyannishar/wreck-it finding add --file finding.json
npx @miyannishar/wreck-it a11y http://localhost:3000/ --record
npx @miyannishar/wreck-it load http://localhost:3000/api/products --profile ramp
npx @miyannishar/wreck-it report && npx @miyannishar/wreck-it gen-tests
```

The CLI never calls an LLM, needs no API key, and refuses non-local targets unless you pass `--i-own-this`. Requires Node ≥ 22.19.

MIT
