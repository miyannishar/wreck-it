# wreck-it (CLI)

**Wreck your app before your users do.**

This is the deterministic half of [wreck-it](https://github.com/miyannishar/wreck-it): setup, discovery, finding storage, oddity detector, axe-core scans, API fuzzing (plus Schemathesis), Lighthouse page speed, autocannon load tests, the readiness score, HTML/Markdown reports and Playwright regression tests. Your coding agent drives it through the wreck-it skills. See the main README for setup.

```bash
npx @miyanishar/wreck-it setup                     # browsers, Playwright MCP + Chrome DevTools MCP for your agents, Schemathesis
npx @miyanishar/wreck-it discover
npx @miyanishar/wreck-it preflight --wait 30
npx @miyanishar/wreck-it sweep --record
npx @miyanishar/wreck-it fuzz --record
npx @miyanishar/wreck-it perf --record
npx @miyanishar/wreck-it finding add --file finding.json
npx @miyanishar/wreck-it a11y http://localhost:3000/ --record
npx @miyanishar/wreck-it load http://localhost:3000/api/products --profile ramp
npx @miyanishar/wreck-it report && npx @miyanishar/wreck-it gen-tests
```

The CLI never calls an LLM, needs no API key, and refuses non-local targets unless you pass `--i-own-this`. Requires Node ≥ 22.19.

Version 0.2.0 adds completion waits, input-value and text-pattern assertions, and checks of rendered images and links. Generated app URLs honor `WRECK_IT_BASE_URL`. Regeneration preserves edited specs and sidecar fixtures; inspect its warnings when findings change. Use `gen-tests --force` only when intentionally replacing custom WR specs. Generated tests need review and `@playwright/test` to run.

See the [release notes and validation](https://github.com/miyannishar/wreck-it/blob/main/docs/releases/0.2.0.md).

MIT
